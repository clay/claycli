'use strict';

const fs = require('fs-extra');
const { globSync } = require('glob');
const path = require('path');

const { KILN_EDIT_ENTRY_KEY, VIEW_INIT_ENTRY_KEY } = require('./scripts');

const DEST = path.resolve(process.cwd(), 'public', 'js');
const MANIFEST_PATH = path.join(DEST, '_manifest.json');

/**
 * Read and return the _manifest.json written by `clay build`.
 * Returns null when no manifest has been built yet.
 *
 * @returns {object|null}
 */
function readManifest() {
  try {
    return fs.readJsonSync(MANIFEST_PATH);
  } catch {
    return null;
  }
}

/**
 * Convert an old-style Browserify module-ID path back to a component key
 * as it appears in _manifest.json.
 *
 * Old format:  '/assetPath/js/article.client.js'
 * Manifest key: 'components/article/client'
 *
 * Handles components, layouts, and kiln plugins.
 *
 * @param {string} publicPath - e.g. 'https://cdn.example.com/js/article.client.js'
 * @returns {string|null}
 */
function publicPathToManifestKey(publicPath) {
  const basename = publicPath.split('/').pop().replace(/\.js$/, '');

  // article.client  → components/article/client
  // article.model   → components/article/model
  // article.kiln    → components/article/kiln
  const componentMatch = basename.match(/^(.+)\.(client|model|kiln)$/);

  if (componentMatch) {
    return `components/${componentMatch[1]}/${componentMatch[2]}`;
  }

  // layout-foo.client → layouts/layout-foo/client
  const layoutMatch = basename.match(/^(.+layout[^.]*)\.(client|model)$/i);

  if (layoutMatch) {
    return `layouts/${layoutMatch[1]}/${layoutMatch[2]}`;
  }

  return null;
}

/**
 * Recursively collect the entry file + all its imported chunks.
 *
 * @param {string}   key         - Manifest key e.g. 'components/article/client'
 * @param {object}   manifest    - Parsed _manifest.json
 * @param {Set}      seen        - Already-visited entries (avoids duplicates)
 * @param {string}   base        - Public URL base prefix e.g. '/js'
 * @param {boolean}  [chunksOnly] - When true, skip individual component client
 *                                  files from the imports list (only shared chunks
 *                                  under /chunks/). Used for global entry points
 *                                  like init.js whose manifest imports list all 220+
 *                                  component client files as potential dynamic imports.
 * @returns {string[]}
 */
function collectScripts(key, manifest, seen, base, chunksOnly) {
  const entry = manifest[key];

  if (!entry || seen.has(key)) return [];
  seen.add(key);

  const scripts = [];

  // Guard entry.file against duplicates — a global entry (e.g. global/js/ads)
  // may have already been added as a shared import of a previously processed
  // entry (e.g. components/init).
  if (!seen.has(entry.file)) {
    seen.add(entry.file);
    scripts.push(entry.file.replace(/^\/js/, base || '/js'));
  }

  for (const chunk of entry.imports || []) {
    if (seen.has(chunk)) continue;
    // When chunksOnly is set, skip individual component client files —
    // they are dynamic imports of init.js and will be loaded on demand,
    // not as eager <script> tags.
    if (chunksOnly && !chunk.includes('/chunks/')) continue;
    seen.add(chunk);
    scripts.push(chunk.replace(/^\/js/, base || '/js'));
  }

  return scripts;
}

/**
 * Return an array of hashed script URLs that should be loaded for the given
 * component scripts in view mode.
 *
 * Drop-in replacement for `getDependencies` (Browserify version) when
 * _manifest.json is present.
 *
 * @param {string[]} scripts   - Array of public script paths from amphora media
 * @param {string}   assetPath - Site asset prefix (e.g. 'https://cdn.example.com')
 * @param {object}   [options]
 * @param {boolean}  [options.edit] - true when in Kiln edit mode
 * @returns {string[]}
 */
function getDependenciesNext(scripts, assetPath, options) {
  const manifest = readManifest();

  if (!manifest) {
    throw new Error(
      'clay build: _manifest.json not found.\n' +
      'Run `clay build` first to generate the build output.'
    );
  }

  const base = (assetPath || '') + '/js';
  const seen = new Set();

  if (options && options.edit) {
    return getEditDeps(manifest, base, seen);
  }

  return getViewDeps(scripts, manifest, base, seen);
}

/**
 * Return an array of hashed script URLs that should be loaded for a page
 * rendered with the clay build (esbuild/ESM) pipeline.
 *
 * Only emits _view-init, global entry points, and their shared chunks.
 * Per-component client.js files are intentionally excluded — _view-init
 * scans the DOM and imports them on demand, so eager <script> tags per
 * component are both unnecessary and harmful (1000+ requests in edit mode).
 *
 * @param {string}   assetPath  - Site asset prefix (e.g. 'https://cdn.example.com')
 * @param {string[]} [globalKeys] - Extra manifest keys always loaded (e.g. global scripts)
 * @returns {string[]}
 */
function getDependenciesNextForComponents(assetPath, globalKeys) {
  const manifest = readManifest();

  if (!manifest) {
    throw new Error(
      'clay build: _manifest.json not found.\n' +
      'Run `clay build` first to generate the build output.'
    );
  }

  const base = (assetPath || '') + '/js';
  const seen = new Set();
  const result = [];

  // Always prepend _view-init first — it installs the sticky-event shim and
  // mounts component modules on demand. chunksOnly=true avoids pulling in the
  // 220+ component client files esbuild lists as potential dynamic imports.
  if (manifest[VIEW_INIT_ENTRY_KEY]) {
    result.push(...collectScripts(VIEW_INIT_ENTRY_KEY, manifest, seen, base, true));
  }

  // Global entry points (aaa-module-mounting, ads, facebook, cid, …)
  for (const key of (globalKeys || [])) {
    if (manifest[key]) {
      result.push(...collectScripts(key, manifest, seen, base, true));
    }
  }

  return result;
}

/**
 * Return the hashed script URLs for the kiln edit-mode aggregator bundle.
 *
 * The aggregator (generated by generateKilnEditEntry in scripts.js) pre-populates
 * window.kiln.componentModels, window.kiln.componentKilnjs, and calls the site
 * kiln plugin initializer — everything clay-kiln's preload action needs without
 * the Browserify window.modules / window.require runtime.
 *
 * @param {string} assetPath - Site asset prefix (e.g. 'https://cdn.example.com')
 * @returns {string[]}
 */
function getEditScripts(assetPath) {
  const manifest = readManifest();

  if (!manifest || !manifest[KILN_EDIT_ENTRY_KEY]) return [];

  const base = (assetPath || '') + '/js';
  const seen = new Set();

  return collectScripts(KILN_EDIT_ENTRY_KEY, manifest, seen, base);
}

/**
 * Collect all model/kiln entry points for Kiln edit mode (legacy helper).
 * Kept for backwards compatibility; prefer getEditScripts() for the ESM path.
 *
 * @param {object} manifest
 * @param {string} base
 * @param {Set}    seen
 * @returns {string[]}
 */
function getEditDeps(manifest, base, seen) {
  const result = [];

  for (const key of Object.keys(manifest)) {
    if (key.endsWith('/model') || key.endsWith('/kiln')) {
      result.push(...collectScripts(key, manifest, seen, base));
    }
  }

  const kilnKey = 'services/kiln/index';

  if (manifest[kilnKey]) {
    result.push(...collectScripts(kilnKey, manifest, seen, base));
  }

  return result;
}

/**
 * Collect only the scripts needed for the requested component set (view mode).
 *
 * @param {string[]} scripts
 * @param {object}   manifest
 * @param {string}   base
 * @param {Set}      seen
 * @returns {string[]}
 */
function getViewDeps(scripts, manifest, base, seen) {
  const result = [];

  for (const scriptPath of scripts) {
    const key = publicPathToManifestKey(scriptPath);

    if (key && manifest[key]) {
      result.push(...collectScripts(key, manifest, seen, base));
    }
  }

  return result;
}

/**
 * Returns true when _manifest.json exists on disk, meaning clay build output
 * is available. Consuming code can use this to branch between the old
 * Browserify getDependencies and the new getDependenciesNext.
 *
 * @returns {boolean}
 */
function hasManifest() {
  return fs.existsSync(MANIFEST_PATH);
}

/**
 * Return an array of template script paths produced by clay build.
 *
 * In non-minified mode: individual {name}.template.js files.
 * In minified mode: bucketed _templates-{a-d}.js files.
 * Both forms may co-exist on disk; all are returned.
 *
 * @returns {string[]}
 */
function getTemplatePaths() {
  const individual = globSync(path.join(DEST, '*.template.js'));
  const buckets = globSync(path.join(DEST, '_templates-*.js'));

  return [...individual, ...buckets]
    .map(f => path.relative(path.join(DEST, '..'), f));
}

module.exports = { getDependenciesNext, getDependenciesNextForComponents, hasManifest, getTemplatePaths, getEditScripts };

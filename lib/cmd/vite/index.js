'use strict';

const {
  build,
  watch,
  getViteConfig,
  VITE_BOOTSTRAP_KEY,
  VITE_BOOTSTRAP_NO_MOUNT_KEY,
  KILN_EDIT_ENTRY_KEY,
} = require('./scripts');

const fs = require('fs');
const path = require('path');
const { globSync } = require('glob');

const CWD = process.cwd();
const DEST = path.resolve(CWD, 'public', 'js');
const MANIFEST_PATH = path.join(DEST, '_manifest.json');

// ── Manifest helpers ─────────────────────────────────────────────────────────

/**
 * Returns true when public/js/_manifest.json exists on disk, meaning a Vite
 * build has completed. Used by resolve-media.js to gate on the pipeline.
 *
 * @returns {boolean}
 */
function hasManifest() {
  return fs.existsSync(MANIFEST_PATH);
}

/**
 * Read and return the _manifest.json written by `clay vite`.
 * Returns null when no manifest exists yet.
 *
 * @returns {object|null}
 */
function readManifest() {
  try {
    return JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  } catch (_) {
    return null;
  }
}

// ── Script URL helpers ───────────────────────────────────────────────────────

/**
 * Return one bootstrap entry's script URL, rebased onto the site's asset
 * host/prefix. Returns [] when the entry is absent from the manifest.
 *
 * @param {string} key         - manifest key of the bootstrap entry
 * @param {string} [assetPath] - site asset prefix (e.g. 'https://cdn.example.com')
 * @returns {string[]}
 */
function getBootstrapScripts(key, assetPath) {
  if (!hasManifest()) return [];

  const manifest = readManifest();

  if (!manifest) return [];

  const base  = (assetPath || '') + '/js';
  const entry = manifest[key];

  if (!entry || !entry.file) return [];

  return [entry.file.replace(/^\/js/, base)];
}

/**
 * Return the bootstrap script URL for view mode.
 * One <script type="module"> tag is all the browser needs —
 * the bootstrap handles lazy-loading all components on demand.
 *
 * @param {string} [assetPath] - site asset prefix (e.g. 'https://cdn.example.com')
 * @returns {string[]}
 */
function getViteViewScripts(assetPath) {
  return getBootstrapScripts(VITE_BOOTSTRAP_KEY, assetPath);
}

/**
 * Return the bootstrap script URL for edit mode.
 *
 * Always the no-mount variant, so component client.js files never execute while
 * an editor is in Kiln — see generateViteBootstrap() for why that matters.
 *
 * Falls back to the mounting bootstrap when the no-mount entry is absent, which
 * happens when public/js was built by a claycli predating it. That fallback
 * reintroduces client.js-in-edit-mode, but serving no initializers at all would
 * break Kiln outright, so a stale manifest degrades rather than fails.
 *
 * @param {string} [assetPath]
 * @returns {string[]}
 */
function getViteEditBootstrapScripts(assetPath) {
  const noMount = getBootstrapScripts(VITE_BOOTSTRAP_NO_MOUNT_KEY, assetPath);

  return noMount.length ? noMount : getViteViewScripts(assetPath);
}

/**
 * Return the same URL list for <link rel="modulepreload"> hints.
 *
 * @param {string} [assetPath]
 * @returns {string[]}
 */
function getViteModulePreloads(assetPath) {
  return getViteViewScripts(assetPath);
}

/**
 * Return the hashed script URLs for the Kiln edit-mode bundle.
 *
 * @param {string} [assetPath]
 * @returns {string[]}
 */
function getEditScripts(assetPath) {
  if (!hasManifest()) return [];

  const manifest = readManifest();
  const entry    = manifest && manifest[KILN_EDIT_ENTRY_KEY];

  if (!entry || !entry.file) return [];

  const base = (assetPath || '') + '/js';
  const rebase = p => p.replace(/^\/js/, base);

  return [entry.file].concat(entry.imports || []).map(rebase);
}

/**
 * Populate media.moduleScripts and media.modulePreloads for amphora-html.
 *
 * In view mode: one bootstrap URL.
 * In edit mode: the no-mount bootstrap + kiln edit bundle.
 *
 * @param {object}  media
 * @param {string}  assetPath
 * @param {object}  [options]
 * @param {boolean} [options.edit=false]
 * @param {boolean} [options.preloadEditBundle=false]
 */
function resolveModuleScripts(media, assetPath, options) {
  if (!hasManifest()) return;

  const { edit = false, preloadEditBundle = false } = options || {};

  if (edit) {
    const editScripts      = getEditScripts(assetPath);
    const bootstrapScripts = getViteEditBootstrapScripts(assetPath);

    // Keep bootstrap first so shared env/bootstrap globals are available
    // before the kiln edit entry executes.
    media.moduleScripts  = [...bootstrapScripts, ...editScripts];
    media.modulePreloads = preloadEditBundle
      ? [...bootstrapScripts, ...editScripts]
      : bootstrapScripts;
  } else {
    media.moduleScripts  = getViteViewScripts(assetPath);
    media.modulePreloads = getViteModulePreloads(assetPath);
    media.scripts        = [];
  }
}

/**
 * Return Handlebars template script paths produced by the clay build.
 * Vite does not produce templates — these come from the shared templates
 * step and live in public/js/ alongside JS chunks.
 *
 * @returns {string[]}
 */
function getTemplatePaths() {
  const individual = globSync(path.join(DEST, '*.template.js'));
  const buckets    = globSync(path.join(DEST, '_templates-*.js'));

  return [...individual, ...buckets]
    .map(f => path.relative(path.join(DEST, '..'), f));
}

/**
 * Compatibility shim — not used by the Vite pipeline (the bootstrap handles
 * per-component script resolution at runtime) but exported so that any code
 * that calls getDependenciesNext on the active pipeline adapter doesn't
 * throw when the Vite pipeline is selected.
 *
 * @returns {string[]}
 */
function getDependenciesNext() {
  return [];
}

module.exports = {
  build,
  watch,
  getViteConfig,
  hasManifest,
  resolveModuleScripts,
  getEditScripts,
  getTemplatePaths,
  getDependenciesNext,
  VITE_BOOTSTRAP_KEY,
  VITE_BOOTSTRAP_NO_MOUNT_KEY,
  KILN_EDIT_ENTRY_KEY,
};

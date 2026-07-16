'use strict';

const { build, watch, getViteConfig, VITE_BOOTSTRAP_KEY, KILN_EDIT_ENTRY_KEY } = require('./scripts');

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
 * Return a manifest entry's file URL plus its static import chunk URLs, each
 * rebased onto the site's asset host/prefix. Returns [] when the entry is
 * missing (component has no client.js, or the build didn't emit it) or has no
 * file. This is the shared primitive behind the module/preload resolvers.
 *
 * @param {object|undefined} entry  - a { file, imports } manifest entry
 * @param {function} rebase         - maps a `/js/...` URL onto the asset host
 * @returns {string[]}
 */
function entryUrls(entry, rebase) {
  if (!entry || !entry.file) return [];

  return [entry.file].concat(entry.imports || []).map(rebase);
}

/**
 * Build the rebasing function that maps a manifest's `/js/...` URLs onto the
 * site's asset host/prefix (e.g. 'https://cdn.example.com/js/...').
 *
 * @param {string} [assetPath]
 * @returns {function}
 */
function makeRebase(assetPath) {
  const base = (assetPath || '') + '/js';

  return p => p.replace(/^\/js/, base);
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
  if (!hasManifest()) return [];

  const manifest = readManifest();

  if (!manifest) return [];

  const base  = (assetPath || '') + '/js';
  const entry = manifest[VITE_BOOTSTRAP_KEY];

  if (!entry || !entry.file) return [];

  return [entry.file.replace(/^\/js/, base)];
}

/**
 * View-mode <link rel="modulepreload"> URLs: the bootstrap entry PLUS its
 * static import chunks (globals-init, env-init, and the shared chunks the
 * bootstrap pulls in synchronously).
 *
 * Preloading the imports — not just the bootstrap file — lets the browser
 * fetch the whole synchronous startup graph in parallel during HTML parse
 * instead of discovering each chunk only after the bootstrap module itself
 * downloads (one waterfall hop per level). Per-component client chunks are
 * dynamic imports and are NOT included here — use getComponentPreloads().
 *
 * @param {string} [assetPath]
 * @returns {string[]}
 */
function getViteModulePreloads(assetPath) {
  if (!hasManifest()) return [];

  const manifest = readManifest();

  return entryUrls(manifest && manifest[VITE_BOOTSTRAP_KEY], makeRebase(assetPath));
}

/**
 * Return de-duplicated <link rel="modulepreload"> URLs for a set of component
 * names — each component's client chunk plus its static import chunks — so the
 * server can hint the components that are actually on the page.
 *
 * Why this exists: the view-mode bootstrap mounts components by scanning the
 * DOM and calling import('components/<name>/client.js') at runtime. Those
 * dynamic chunks are not referenced by any tag in the server-rendered HTML, so
 * the browser cannot begin fetching a component's client (or its deps — auth,
 * gtm, shared chunks) until the bootstrap executes. That is a load waterfall
 * that visibly delays JS-gated UI such as the global nav. Preloading the
 * on-page component chunks flattens the waterfall into parallel fetches that
 * start during HTML parse.
 *
 * Relies on the enriched manifest that keys dynamic component entries
 * (buildManifest emits `components/<name>/client`). Names with no manifest
 * entry (no client.js, or not built) are skipped. Callers should merge the
 * result into media.modulePreloads, de-duping against the bootstrap-graph
 * preloads that getViteModulePreloads already provides.
 *
 * @param {string[]} componentNames - component names rendered on the page
 * @param {string}   [assetPath]    - site asset host/prefix
 * @returns {string[]}
 */
function getComponentPreloads(componentNames, assetPath) {
  if (!hasManifest() || !Array.isArray(componentNames) || !componentNames.length) {
    return [];
  }

  const manifest = readManifest();

  if (!manifest) return [];

  const rebase = makeRebase(assetPath);
  const urls   = new Set();

  for (const name of componentNames) {
    for (const url of entryUrls(manifest[`components/${name}/client`], rebase)) {
      urls.add(url);
    }
  }

  return [...urls];
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

  return entryUrls(manifest && manifest[KILN_EDIT_ENTRY_KEY], makeRebase(assetPath));
}

/**
 * Populate media.moduleScripts and media.modulePreloads for amphora-html.
 *
 * moduleScripts (the actual <script type="module"> tags):
 *   view mode → one bootstrap URL; edit mode → bootstrap + kiln edit bundle.
 * modulePreloads (<link rel="modulepreload"> hints):
 *   always the bootstrap's synchronous startup graph (bootstrap file + its
 *   static import chunks). Per-component chunks are added separately by the
 *   server via getComponentPreloads() — see that function for the rationale.
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
  const viewScripts = getViteViewScripts(assetPath);
  const preloads    = getViteModulePreloads(assetPath);

  if (edit) {
    const editScripts = getEditScripts(assetPath);

    // Keep bootstrap first so shared env/bootstrap globals are available
    // before the kiln edit entry executes.
    media.moduleScripts  = [...viewScripts, ...editScripts];
    media.modulePreloads = preloadEditBundle
      ? [...preloads, ...editScripts]
      : preloads;
  } else {
    media.moduleScripts  = viewScripts;
    media.modulePreloads = preloads;
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
  getComponentPreloads,
  getEditScripts,
  getTemplatePaths,
  getDependenciesNext,
  VITE_BOOTSTRAP_KEY,
  KILN_EDIT_ENTRY_KEY,
};

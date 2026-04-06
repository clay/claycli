'use strict';

const { build, watch, getViteConfig, VITE_BOOTSTRAP_KEY, KILN_EDIT_ENTRY_KEY } = require('./scripts');

const fs = require('fs');
const path = require('path');
const { globSync } = require('glob');

const CWD = process.cwd();
const DEST = path.resolve(CWD, 'public', 'js');
const MANIFEST_PATH = path.join(DEST, '_manifest.json');
const CSS_BUILD_ID_PATH = path.join(CWD, '.clay', 'css-build-id');

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

  return [entry.file, ...(entry.imports || [])].map(rebase);
}

/**
 * Populate media.moduleScripts and media.modulePreloads for amphora-html.
 *
 * In view mode: one bootstrap URL.
 * In edit mode: kiln edit bundle + bootstrap.
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

    media.moduleScripts  = [...editScripts, ...viewScripts];
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

/**
 * Returns the CSS build ID written by `clay vite --watch` after each CSS
 * rebuild, or null if no watch build has run yet.
 *
 * Used by resolve-media.js to append ?v=<id> to CSS URLs so the browser
 * cache-busts on each rebuild without requiring a server restart.
 *
 * @returns {string|null}
 */
function getCssBuildId() {
  try {
    return fs.readFileSync(CSS_BUILD_ID_PATH, 'utf8').trim() || null;
  } catch (_) {
    return null;
  }
}

module.exports = {
  build,
  watch,
  getViteConfig,
  hasManifest,
  getCssBuildId,
  resolveModuleScripts,
  getEditScripts,
  getTemplatePaths,
  getDependenciesNext,
  VITE_BOOTSTRAP_KEY,
  KILN_EDIT_ENTRY_KEY,
};

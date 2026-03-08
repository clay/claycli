'use strict';

const { build, watch, getEsbuildConfig, generateClientEnv, GLOBALS_INIT_ENTRY_KEY } = require('./scripts');
const { getDependenciesNext, getDependenciesNextForComponents, getModulePreloadHints, hasManifest, getTemplatePaths, getEditScripts } = require('./get-script-dependencies');

const GLOBAL_KEYS = [GLOBALS_INIT_ENTRY_KEY];

/**
 * Populate `media.moduleScripts` and `media.modulePreloads` for the esbuild
 * pipeline. No-op when no manifest is present (Browserify sites are unaffected).
 *
 * View mode: sets moduleScripts to global entry points + shared chunks,
 *   sets modulePreloads to the same list, clears media.scripts.
 *
 * Edit mode: prepends the view-mode scripts then appends the kiln edit bundle,
 *   sets modulePreloads to the view-mode scripts only (edit bundle excluded by
 *   default — see preloadEditBundle option).
 *
 * @param {Object}  media
 * @param {string}  assetPath             - Site asset prefix (e.g. 'https://cdn.example.com')
 * @param {Object}  [options]
 * @param {boolean} [options.edit=false]  - true when in Kiln edit mode
 * @param {boolean} [options.preloadEditBundle=false] - opt-in to adding the kiln bundle to preloads
 */
function resolveModuleScripts(media, assetPath, options) {
  if (!hasManifest()) return;

  const { edit = false, preloadEditBundle = false } = options || {};
  const viewScripts = getDependenciesNextForComponents(assetPath, GLOBAL_KEYS);
  const preloads = getModulePreloadHints(assetPath, GLOBAL_KEYS);

  if (edit) {
    const editScripts = getEditScripts(assetPath);

    media.moduleScripts = [...viewScripts, ...editScripts];
    media.modulePreloads = preloadEditBundle
      ? [...preloads, ...editScripts]
      : preloads;
  } else {
    media.moduleScripts = viewScripts;
    media.modulePreloads = preloads;
    media.scripts = [];
  }
}

exports.build = build;
exports.watch = watch;
exports.getEsbuildConfig = getEsbuildConfig;
exports.generateClientEnv = generateClientEnv;
exports.GLOBALS_INIT_ENTRY_KEY = GLOBALS_INIT_ENTRY_KEY;
exports.getDependenciesNext = getDependenciesNext;
exports.getDependenciesNextForComponents = getDependenciesNextForComponents;
exports.getModulePreloadHints = getModulePreloadHints;
exports.hasManifest = hasManifest;
exports.getTemplatePaths = getTemplatePaths;
exports.getEditScripts = getEditScripts;
exports.resolveModuleScripts = resolveModuleScripts;

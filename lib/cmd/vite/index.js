'use strict';

const { build, watch, getRollupConfig, GLOBALS_INIT_ENTRY_KEY } = require('./scripts');
const { getDependenciesNext, getDependenciesNextForComponents, getModulePreloadHints, hasManifest, getTemplatePaths, getEditScripts } = require('../build/get-script-dependencies');

const GLOBAL_KEYS = [GLOBALS_INIT_ENTRY_KEY];

/**
 * Populate `media.moduleScripts` and `media.modulePreloads` for the Rollup
 * pipeline. No-op when no manifest is present (Browserify sites are unaffected).
 *
 * Identical signature and behaviour to lib/cmd/build/index.js resolveModuleScripts
 * so resolve-media.js can swap bundlers transparently.
 *
 * @param {Object}  media
 * @param {string}  assetPath
 * @param {Object}  [options]
 * @param {boolean} [options.edit=false]
 * @param {boolean} [options.preloadEditBundle=false]
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
exports.getRollupConfig = getRollupConfig;
exports.GLOBALS_INIT_ENTRY_KEY = GLOBALS_INIT_ENTRY_KEY;
exports.getDependenciesNext = getDependenciesNext;
exports.getDependenciesNextForComponents = getDependenciesNextForComponents;
exports.getModulePreloadHints = getModulePreloadHints;
exports.hasManifest = hasManifest;
exports.getTemplatePaths = getTemplatePaths;
exports.getEditScripts = getEditScripts;
exports.resolveModuleScripts = resolveModuleScripts;

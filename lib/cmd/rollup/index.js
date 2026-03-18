'use strict';

const { build, watch, getRollupConfig, ROLLUP_BOOTSTRAP_KEY } = require('./scripts');
const {
  getDependenciesNext,
  hasManifest,
  getTemplatePaths,
  getEditScripts,
} = require('../build/get-script-dependencies');
const fs = require('fs');
const path = require('path');

const MANIFEST_PATH = path.resolve(process.cwd(), 'public', 'js', '_manifest.json');

/**
 * View mode: one script tag — bootstrap statically imports globals; browser loads chunks.
 * Returns empty array if manifest is not present yet (e.g. during container startup).
 */
function getRollupViewScripts(assetPath) {
  if (!hasManifest()) return [];

  let manifest;

  try {
    manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  } catch (e) {
    return [];
  }

  const base = (assetPath || '') + '/js';
  const entry = manifest[ROLLUP_BOOTSTRAP_KEY];

  if (!entry || !entry.file) return [];

  return [entry.file.replace(/^\/js/, base)];
}

function getRollupModulePreloads(assetPath) {
  if (!hasManifest()) return [];

  return getRollupViewScripts(assetPath);
}

/**
 * @param {Object}  media
 * @param {string}  assetPath
 * @param {Object}  [options]
 */
function resolveModuleScripts(media, assetPath, options) {
  if (!hasManifest()) return;

  const { edit = false, preloadEditBundle = false } = options || {};
  const viewScripts = getRollupViewScripts(assetPath);
  const preloads = getRollupModulePreloads(assetPath);

  if (edit) {
    const editScripts = getEditScripts(assetPath);

    media.moduleScripts = [...editScripts, ...viewScripts];
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
exports.ROLLUP_BOOTSTRAP_KEY = ROLLUP_BOOTSTRAP_KEY;
exports.getDependenciesNext = getDependenciesNext;
exports.getDependenciesNextForComponents = assetPath => getRollupViewScripts(assetPath);
exports.getModulePreloadHints = getRollupModulePreloads;
exports.hasManifest = hasManifest;
exports.getTemplatePaths = getTemplatePaths;
exports.getEditScripts = getEditScripts;
exports.resolveModuleScripts = resolveModuleScripts;

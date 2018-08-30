'use strict';
const _ = require('lodash'),
  path = require('path'),
  glob = require('glob'),
  // destination paths
  destPath = path.resolve(process.cwd(), 'public', 'js'),
  registryPath = path.resolve(destPath, '_registry.json');

/**
 * get all dependencies (for edit mode)
 * @param  {boolean} minify
 * @return {array}
 */
function getAllDeps(minify) {
  if (minify) {
    // return ['_deps-a-d', '_deps-e-h'...]
    return glob.sync(path.join(destPath, '_deps-?-?.js')).map((filepath) => path.parse(filepath).name);
  } else {
    // return ['1', '2'...]
    return glob.sync(path.join(destPath, '+([0-9]).js')).map((filepath) => path.parse(filepath).name);
  }
}

/**
 * get all models (for edit mode)
 * @param  {boolean} minify
 * @return {array}
 */
function getAllModels(minify) {
  if (minify) {
    // return ['_models-a-d', '_models-e-h'...]
    return glob.sync(path.join(destPath, '_models-?-?.js')).map((filepath) => path.parse(filepath).name);
  } else {
    // return ['ad.model', 'article.model'...]
    return glob.sync(path.join(destPath, '*.model.js')).map((filepath) => path.parse(filepath).name);
  }
}

/**
 * get all component templates (for edit mode)
 * @param  {boolean} minify
 * @return {array}
 */
function getAllTemplates(minify) {
  if (minify) {
    // return ['_templates-a-d', '_templates-e-h'...]
    return glob.sync(path.join(destPath, '_templates-?-?.js')).map((filepath) => path.parse(filepath).name);
  } else {
    // return ['ad.template', 'article.template'...]
    return glob.sync(path.join(destPath, '*.template.js')).map((filepath) => path.parse(filepath).name);
  }
}

/**
 * convert a module ID to a public path
 * @param  {string} moduleId  e.g. 'foo'
 * @param  {string} assetPath e.g. '/site-path/'
 * @return {string} e.g. '/site-path/js/foo.js'
 */
function idToPublicPath(moduleId, assetPath = '') {
  return `${assetPath}/js/${moduleId}.js`;
}

/**
 * convert a public asset path to a module ID
 * @param {string} publicPath e.g. https://localhost.cache.com/media/js/tags.client.js
 * @return {string} e.g. tags.client
 */
function publicPathToID(publicPath) {
  return publicPath.split('/').pop().replace('.js', '');
}

/**
 * recursively compute deps, mutating the 'out' object
 * @param  {string} dep
 * @param  {object} out
 * @param  {object} registry
 * @return {undefined}
 */
function computeDep(dep, out, registry) {
  if (!out[dep]) {
    out[dep] = true;
    if (registry && registry[dep]) {
      registry[dep].forEach((regDep) => computeDep(regDep, out, registry));
    } else {
      throw new Error(`Dependency Error: "${dep}" not found in registry. Please clear your public/js directory and recompile scripts`);
    }
  }
}

/**
 * compute an array of dependency IDs from specified module IDs (plus legacy _global.js)
 * @param  {array} entryIDs
 * @return {array}
 */
function getComputedDeps(entryIDs) {
  const registry = require(registryPath) || {},
    legacyIDs = Object.keys(registry).filter((key) => _.endsWith(key, '.legacy')),
    out = {};

  // compute deps for client.js files
  entryIDs.forEach((entry) => computeDep(entry, out, registry));
  // compute deps for legacy _global.js if they exist
  legacyIDs.forEach((id) => computeDep(id, out, registry));
  return Object.keys(out);
}

/**
 * from an array of js files, return an array of dependencies
 * note: this should be called by your Clay instance's `resolveMedia` function/service
 * @param  {arrray}  scripts from resolveMedia's 'media.scripts'
 * @param  {string}  assetPath to generate the filepaths from
 * @param  {object}  [options]
 * @param  {boolean} [options.edit] if we're in edit mode or not
 * @param  {boolean} [options.minify] if we should send bundles or individual files
 * @return {array}
 */
function getDependencies(scripts, assetPath, options = {}) {
  const edit = options.edit,
    minify = options.minify;

  if (edit) {
    return _.flatten([
      '_prelude',
      getAllDeps(minify), // dependencies for model.js and kiln plugins
      getAllModels(minify), // model.js files
      getAllTemplates(minify),
      '_kiln-plugins', // kiln plugins
      '_postlude'
    ]).map((id) => idToPublicPath(id, assetPath));
  } else {
    const entryIDs = scripts.map(publicPathToID);

    return _.flatten([
      '_prelude',
      getComputedDeps(entryIDs, minify), // dependencies for client.js and legacy js
      '_postlude',
      '_client-init'
    ]).map((id) => idToPublicPath(id, assetPath));
  }
}

module.exports.getDependencies = getDependencies;

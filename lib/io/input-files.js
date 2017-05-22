const path = require('path'),
  fs = require('fs-extra'),
  yaml = require('js-yaml'),
  glob = require('glob'),
  bluebird = require('bluebird'),
  isDirectory = require('is-directory'),
  chunks = require('./agnostic-chunks'),
  _ = require('lodash');

function getSchema(filepath) {
  return fs.readFile(filepath, 'utf8')
    .then((contents) => yaml.safeLoad(contents));
}

function getTemplate(filepath) {
  return fs.readFile(filepath, 'utf8');
}

function getYaml(filepath) {
  return fs.readFile(filepath, 'utf8')
    .then((contents) => yaml.safeLoad(contents))
    .then((contents) => chunks.parseObject(contents));
}

function getJSON(filepath) {
  return fs.readJSON(filepath)
    .then((contents) => chunks.parseObject(contents));
}

/**
 * get all globbed files and run parsers against them
 * @param  {string}   filepath
 * @param  {string}   cwd
 * @param  {Function} fn
 * @return {Promise}
 */
function getFilesInFolder(filepath, cwd, fn) {
  const options = { cwd },
    files = glob.sync(filepath, options);

  return bluebird.reduce(files, (result, filename) => {
    return fn(path.resolve(cwd, filename)).then((content) => _.assign(result, { [filename]: content }));
  }, {});
}

/**
 * get all globbed files, run parsers against them, then merge the contents
 * because they're bootstraps
 * @param  {string}   filepath
 * @param  {string}   cwd
 * @param  {Function} fn
 * @return {Promise}
 */
function mergeFilesInFolder(filepath, cwd, fn) {
  const options = { cwd },
    files = glob.sync(filepath, options);

  return bluebird.reduce(files, (chunks, filename) => {
    return fn(path.resolve(cwd, filename)).then((fileChunks) => _.assign(chunks, fileChunks));
  }, {});
}

function getFolder(filepath, isRecursive) {
  const schemaPaths = 'schema.+(yml|yaml)',
    templatePaths = 'template.+(hbs|handlebars)',
    bootstrapPaths = '!(schema).+(yml|yaml)',
    jsonPaths = '*.json',
    recurse = '**/';

  if (isRecursive) {
    return bluebird.props({
      schemas: getFilesInFolder(recurse + schemaPaths, filepath, getSchema),
      templates: getFilesInFolder(recurse + templatePaths, filepath, getTemplate),
      bootstraps: mergeFilesInFolder(recurse + bootstrapPaths, filepath, getYaml),
      json: mergeFilesInFolder(recurse + jsonPaths, filepath, getJSON)
    });
  } else {
    return bluebird.props({
      schemas: getFilesInFolder(schemaPaths, filepath, getSchema),
      templates: getFilesInFolder(templatePaths, filepath, getTemplate),
      bootstraps: mergeFilesInFolder(bootstrapPaths, filepath, getYaml),
      json: mergeFilesInFolder(jsonPaths, filepath, getJSON)
    });
  }
}

/**
 * get and parse files
 * @param  {string} filepath
 * @param {boolean} [isRecursive]
 * @return {Promise}
 */
function getFile(filepath, isRecursive) {
  const ext = path.extname(filepath);

  if (_.includes(filepath, 'schema.yml') || _.includes(filepath, 'schema.yaml')) {
    // get schema
    return bluebird.props({ schemas: getSchema(filepath).then((schema) => ({ [filepath]: schema })) });
  } else if (_.includes(['.yml', '.yaml'], ext)) {
    // get and parse bootstrap yaml into chunks
    return bluebird.props({ bootstraps: getYaml(filepath) });
  } else if (ext === 'json') {
    // get and parse bootstrap json into chunks
    return bluebird.props({ json: getJSON(filepath) });
  } else if (isDirectory.sync(filepath)) {
    return getFolder(filepath, isRecursive);
  } else {
    throw new Error(`Unknown file path: ${filepath}`);
  }
}

module.exports.get = getFile;

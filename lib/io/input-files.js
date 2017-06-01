'use strict';

const path = require('path'),
  fs = require('fs-extra'),
  yaml = require('js-yaml'),
  glob = require('glob'),
  isDirectory = require('is-directory'),
  h = require('highland'),
  chunks = require('./agnostic-chunks'),
  _ = require('lodash');

/**
 * convenience function for fs.readFile
 * @param  {string} filepath
 * @return {Stream}
 */
function read(filepath) {
  return h(fs.readFile(filepath, 'utf8'));
}

/**
 * get schema from filepath
 * @param  {string} filepath
 * @return {Stream} of { filepath: schema }
 */
function getSchema(filepath) {
  return read(filepath).map(yaml.safeLoad);
}

/**
 * get yaml bootstraps as a stream of agnostic chunks
 * @param  {string} filepath
 * @return {Stream}
 */
function getYaml(filepath) {
  return read(filepath)
    .map(yaml.safeLoad)
    .flatMap(chunks.parseObject)
    .errors((err, push) => {
      if (err.name === 'YAMLException') {
        // propagate filepath on yaml parsing errors,
        // so end users have enough info to debug
        err.filepath = filepath;
      }
      push(err);
    });
}

/**
 * get json bootstraps as a stream of agnostic chunks
 * @param  {string} filepath
 * @return {Stream}
 */
function getJSON(filepath) {
  return h(fs.readJSON(filepath)).flatMap(chunks.parseObject);
}

/**
 * resolve filepath + filename from glob
 * @param  {string} cwd
 * @return {function}
 */
function resolvePaths(cwd) {
  return (filename) => {
    return path.resolve(cwd, filename);
  };
}

function getFolder(filepath, isRecursive) {
  const recurse = '**/';

  let schemas = 'schema.+(yml|yaml)',
    yamlBootstraps = '!(schema).+(yml|yaml)',
    jsonBootstraps = '*.json',
    schemaStream, yamlStream, jsonStream;

  if (isRecursive) {
    schemas = recurse + schemas;
    yamlBootstraps = recurse + yamlBootstraps;
    jsonBootstraps = recurse + jsonBootstraps;
  }

  // generate data from files
  schemaStream = h(glob.sync(schemas, { cwd: filepath }))
    .map(resolvePaths(filepath))
    .flatMap((filename) => getSchema(filename).reduce({}, (result, schema) => _.assign(result, { [filename]: schema})));
  yamlStream = h(glob.sync(yamlBootstraps, { cwd: filepath })).map(resolvePaths(filepath)).flatMap(getYaml);
  jsonStream = h(glob.sync(jsonBootstraps, { cwd: filepath })).map(resolvePaths(filepath)).flatMap(getJSON);

  // merge the streams together
  return h([schemaStream, yamlStream, jsonStream]).merge();
}

/**
 * get and parse files
 * @param  {string} filepath
 * @param {boolean} [isRecursive]
 * @return {Stream}
 */
function getFile(filepath, isRecursive) {
  const ext = path.extname(filepath);

  if (_.includes(filepath, 'schema.yml') || _.includes(filepath, 'schema.yaml')) {
    // get schema
    return getSchema(filepath);
  } else if (_.includes(['.yml', '.yaml'], ext)) {
    // get and parse bootstrap yaml into chunks
    return getYaml(filepath);
  } else if (ext === '.json') {
    // get and parse bootstrap json into chunks
    return getJSON(filepath);
  } else if (isDirectory.sync(filepath)) {
    return getFolder(filepath, isRecursive);
  } else {
    return h.fromError(new Error(`Unknown file path: ${filepath}`));
  }
}

/**
 * omit schemas from a stream of bootstraps and schemas
 * call this with Stream.filter(omitSchemas)
 * @param  {object} chunk
 * @return {boolean}
 */
function omitSchemas(chunk) {
  const key = Object.keys(chunk)[0];

  return !_.includes(key, 'schema.yml') && !_.includes(key, 'schema.yaml');
}

module.exports.get = getFile;
module.exports.omitSchemas = omitSchemas;

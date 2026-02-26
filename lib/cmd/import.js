'use strict';
const _ = require('lodash'),
  yaml = require('js-yaml'),
  split = require('split-lines'),
  formatting = require('../formatting'),
  prefixes = require('../prefixes'),
  config = require('./config'),
  rest = require('../rest'),
  { mapConcurrent } = require('../concurrency');

/**
 * determine if url is a _uris route
 * these must be PUT as text, not json
 * @param  {string}  url
 * @return {Boolean}
 */
function isURI(url) {
  return _.includes(url, 'uris/');
}

/**
 * send a single dispatch to Clay
 * @param  {object} dispatch
 * @param  {string} prefix
 * @param  {string} key
 * @param  {object} options
 * @return {Promise<array>}
 */
async function sendDispatchToClay(dispatch, prefix, key, options) {
  var rootURI = Object.keys(dispatch)[0],
    url = prefixes.uriToUrl(prefix, rootURI),
    data = dispatch[rootURI];

  var latestRes, pubRes, res, publishRes;

  if (isURI(url)) {
    return [await rest.put(url.replace(/\/$/, ''), data, { key, type: 'text' })];
  } else if (options.publish && _.includes(url, '@published')) {
    latestRes = await rest.put(url.replace('@published', ''), data, { key });
    pubRes = await rest.put(url, undefined, { key });
    return [latestRes, pubRes, { type: 'warning', message: 'Generated latest data for @published item', details: url }];
  } else if (options.publish) {
    res = await rest.put(url, data, { key });
    publishRes = await rest.put(`${url}@published`, undefined, { key });
    return [res, publishRes];
  }
  return [await rest.put(url, data, { key })];
}

/**
 * import a bootstrap into clay
 * @param  {object} obj
 * @param  {string} prefix
 * @param  {string} key
 * @param  {object} options
 * @return {Promise<array>}
 */
async function importBootstrap(obj, prefix, key, options) {
  var dispatches = formatting.toDispatch([obj]),
    concurrency = options.concurrency || 10;

  var allResults = await mapConcurrent(dispatches, concurrency, async (dispatch) => {
    var prefixed = await prefixes.add(dispatch, prefix);

    return sendDispatchToClay(prefixed, prefix, key, options);
  });

  return _.flatten(allResults);
}

/**
 * import dispatch into clay
 * @param  {object} obj
 * @param  {string} prefix
 * @param  {string} key
 * @param  {object} options
 * @return {Promise<array>}
 */
async function importDispatch(obj, prefix, key, options) {
  var prefixed = await prefixes.add(obj, prefix);

  return sendDispatchToClay(prefixed, prefix, key, options);
}

/**
 * parse a source into lines for dispatch processing
 * @param  {string|Buffer|object} source
 * @return {array}
 */
function parseDispatchSource(source) {
  if (_.isString(source)) {
    return source.split('\n').filter(Boolean);
  } else if (Buffer.isBuffer(source)) {
    return source.toString('utf8').split('\n').filter(Boolean);
  } else if (_.isObject(source)) {
    return [source];
  }
  return [];
}

/**
 * parse yaml bootstraps, splitting by duplicate root keys
 * @param  {string} str
 * @return {array} of bootstrap objects
 */
function parseYamlBootstraps(str) {
  var lines = split(str, { preserveNewlines: true });

  return _.reduce(lines, (bootstraps, line) => {
    var rootProps = [
      '_components:\n',
      '_pages:\n',
      '_users:\n',
      '_uris:\n',
      '_lists:\n',
      '_layouts:\n'
    ];

    if (_.includes(rootProps, line)) {
      bootstraps.push(line);
    } else {
      bootstraps[bootstraps.length - 1] += line;
    }
    return bootstraps;
  }, ['']);
}

/**
 * import yaml bootstraps
 * @param  {string} str
 * @param  {string} prefix
 * @param  {string} key
 * @param  {object} options
 * @return {Promise<array>}
 */
async function importYaml(str, prefix, key, options) {
  var chunks, results = [], i, bootstraps, j, obj, bootstrapResults;

  chunks = str.split(/\n==> .*? <==\n/ig).filter((chunk) => chunk && chunk !== '\n');
  for (i = 0; i < chunks.length; i++) {
    bootstraps = parseYamlBootstraps(chunks[i]);
    for (j = 0; j < bootstraps.length; j++) {
      if (!bootstraps[j] || !bootstraps[j].trim()) {
        continue;
      }
      try {
        obj = yaml.load(bootstraps[j]);
      } catch (e) {
        results.push({ type: 'error', message: `YAML syntax error: ${e.message.slice(0, e.message.indexOf(':'))}` });
        continue;
      }
      if (!obj) {
        continue;
      }
      bootstrapResults = await importBootstrap(obj, prefix, key, options);
      results = results.concat(bootstrapResults);
    }
  }
  return results;
}

/**
 * import json dispatches
 * @param  {string|Buffer|object} source
 * @param  {string} prefix
 * @param  {string} key
 * @param  {object} options
 * @return {Promise<array>}
 */
async function importJson(source, prefix, key, options) {
  var items = parseDispatchSource(source),
    concurrency = options.concurrency || 10;

  var allResults = await mapConcurrent(items, concurrency, async (item) => {
    var obj = item;

    if (_.isString(obj)) {
      try {
        obj = JSON.parse(obj);
      } catch (e) {
        try {
          yaml.load(obj);
          return [{ type: 'error', message: 'Cannot import dispatch from yaml', details: 'Please use the --yaml argument to import from bootstraps' }];
        } catch (_otherE) { // eslint-disable-line no-unused-vars
          return [{ type: 'error', message: `JSON syntax error: ${e.message}`, details: _.truncate(obj) }];
        }
      }
    }
    if (obj.type && obj.type === 'error') {
      return [obj];
    }
    return importDispatch(obj, prefix, key, options);
  });

  return _.flatten(allResults);
}

/**
 * import data into clay
 * @param  {string|object|Buffer} str bootstraps or dispatches
 * @param  {string} url to import to (must be a site prefix)
 * @param  {Object} [options={}]
 * @return {Promise<array>}
 */
function importItems(str, url, options) {
  var key, prefix;

  options = options || {};
  key = config.get('key', options.key);
  prefix = config.get('url', url);

  if (!prefix) {
    return Promise.resolve([{ type: 'error', message: 'URL is not defined! Please specify a site prefix to import to' }]);
  }

  if (options.yaml) {
    return importYaml(_.isString(str) ? str : String(str), prefix, key, options);
  }
  return importJson(str, prefix, key, options);
}

/**
 * parse string of bootstraps,
 * returning prefixed dispatches
 * @param  {string} str bootstrap
 * @param  {string} url
 * @return {Promise<array>}
 */
async function parseBootstrap(str, url) {
  var prefix = config.get('url', url), obj, dispatches, i, results = [];

  try {
    obj = yaml.load(str);
  } catch (e) {
    throw new Error(`YAML syntax error: ${e.message.slice(0, e.message.indexOf(':'))}`);
  }
  dispatches = formatting.toDispatch([obj]);
  for (i = 0; i < dispatches.length; i++) {
    results.push(await prefixes.add(dispatches[i], prefix));
  }
  return results;
}

/**
 * parse string of dispatches,
 * returning prefixed dispatches
 * @param  {string} str
 * @param  {string} url
 * @return {Promise<array>}
 */
async function parseDispatch(str, url) {
  var prefix = config.get('url', url),
    lines = str.split('\n').filter(Boolean),
    results = [], i, obj;

  for (i = 0; i < lines.length; i++) {
    try {
      obj = JSON.parse(lines[i]);
    } catch (e) {
      throw new Error(`JSON parser error: ${e.message}`);
    }
    results.push(await prefixes.add(obj, prefix));
  }
  return results;
}

/**
 * parse a json bootstrap object
 * returning prefixed dispatches
 * @param  {object} obj
 * @param  {string} url
 * @return {Promise<array>}
 */
async function parseBootstrapObject(obj, url) {
  var prefix = config.get('url', url),
    dispatches = formatting.toDispatch([obj]),
    results = [], i;

  for (i = 0; i < dispatches.length; i++) {
    results.push(await prefixes.add(dispatches[i], prefix));
  }
  return results;
}

module.exports = importItems;
module.exports.parseBootstrap = parseBootstrap;
module.exports.parseDispatch = parseDispatch;
module.exports.parseBootstrapObject = parseBootstrapObject;

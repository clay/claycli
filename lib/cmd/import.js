'use strict';
const h = require('highland'),
  yaml = require('js-yaml'),
  formatting = require('../formatting'),
  prefixes = require('../prefixes'),
  config = require('./config'),
  rest = require('../rest'),
  DEFAULT_CONCURRENCY = 10;

function sendDispatchToClay(dispatch, prefix, key, options) {
  const rootURI = Object.keys(dispatch)[0],
    url = prefixes.uriToUrl(prefix, rootURI),
    data = dispatch[rootURI];

  if (options.publish) {
    return rest.put(url, data, { key }).concat(rest.put(`${url}@published`, null, { key })); // put to @published with empty data
  } else {
    return rest.put(url, data, { key });
  }
}

/**
 * import a bootstrap into clay
 * @param  {object} obj
 * @param  {string} prefix
 * @param  {string} key
 * @param  {object} options
 * @return {Stream}
 */
function importBootstrap(obj, prefix, key, options) {
  return formatting.toDispatch(h.of(obj))
    .flatMap((dispatch) => prefixes.add(dispatch, prefix))
    .flatMap((dispatch) => sendDispatchToClay(dispatch, prefix, key, options));
}

/**
 * import dispatch into clay
 * @param  {object} obj
 * @param  {string} prefix
 * @param  {string} key
 * @param  {object} options
 * @return {Stream}
 */
function importDispatch(obj, prefix, key, options) {
  return h.of(obj)
    .flatMap((dispatch) => prefixes.add(dispatch, prefix))
    .flatMap((dispatch) => sendDispatchToClay(dispatch, prefix, key, options));
}

/**
 * import data into clay
 * @param  {string} str bootstrap or dispatch
 * @param  {string} url to import to (must be a site prefix)
 * @param  {Object} [options={}]
 * @param  {string} [options.key] api key or alias
 * @param  {string} [options.concurrency]
 * @param  {boolean} [options.publish]
 * @param  {boolean} [options.yaml]
 * @return {Stream}
 */
function importString(str, url, options = {}) {
  const concurrency = options.concurrency || DEFAULT_CONCURRENCY,
    key = config.get('key', options.key),
    prefix = config.get('url', url);

  if (options.yaml) {
    // parse bootstraps
    return h.of(str)
      .splitBy(/\n==> .*? <==\n/ig) // tail -n +1 [file1 file2 ...] | clay import
      .filter((chunk) => chunk && chunk !== '\n')
      .map(yaml.safeLoad)
      .errors((e, push) => {
        push(null, { result: 'error', message: `YAML syntax error: ${e.message.slice(0, e.message.indexOf(':'))}` });
      })
      .map((obj) => {
        if (obj.result && obj.result === 'error') {
          return h.of(obj); // pass through errors
        } else {
          return importBootstrap(obj, prefix, key, options);
        }
      }).parallel(concurrency);
  } else {
    // parse dispatches
    return h.of(str)
      .split()
      .map(JSON.parse)
      .errors((e, push) => {
        push(null, { result: 'error', message: `JSON syntax error: ${e.message}` });
      })
      .map((obj) => {
        if (obj.result && obj.result === 'error') {
          return h.of(obj); // pass through errors
        } else {
          return importDispatch(obj, prefix, key, options);
        }
      }).parallel(concurrency);
  }
}

module.exports = importString;

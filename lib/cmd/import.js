'use strict';
const _ = require('lodash'),
  h = require('highland'),
  yaml = require('js-yaml'),
  split = require('split-lines'),
  formatting = require('../formatting'),
  prefixes = require('../prefixes'),
  config = require('./config'),
  rest = require('../rest'),
  DEFAULT_CONCURRENCY = 10;

/**
 * determine if url is a _uris route
 * these must be PUT as text, not json
 * @param  {string}  url
 * @return {Boolean}
 */
function isURI(url) {
  return _.includes(url, 'uris/');
}

function sendDispatchToClay(dispatch, prefix, key, options) {
  const rootURI = Object.keys(dispatch)[0],
    url = prefixes.uriToUrl(prefix, rootURI),
    data = dispatch[rootURI];

  if (isURI(url)) {
    // PUT text to /_uris/id
    // note: never PUT to /_uris/id@published
    // note: also remove the trailing slash
    return rest.put(url.replace(/\/$/, ''), data, { key, type: 'text' });
  } else if (options.publish && _.includes(url, '@published')) {
    // user wants to publish something, but isn't importing latest data
    // so make it for them and add a warning
    return h(rest.put(url.replace('@published', ''), data, { key }).toPromise(Promise).then((res) => {
      return h.of(res).concat(rest.put(url, undefined, { key })).concat(h.of({ type: 'warning', message: 'Generated latest data for @published item', details: url }));
    })).flatten();
  } else if (options.publish) {
    // PUT to latest and then PUT to @published
    return h(rest.put(url, data, { key }).toPromise(Promise).then((res) => {
      return h.of(res).concat(rest.put(`${url}@published`, undefined, { key }));
    })).flatten();
  } else {
    // PUT to latest
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
 * @param  {string|Stream} str (stream of) bootstraps or dispatches
 * @param  {string} url to import to (must be a site prefix)
 * @param  {Object} [options={}]
 * @param  {string} [options.key] api key or alias
 * @param  {string} [options.concurrency]
 * @param  {boolean} [options.publish]
 * @param  {boolean} [options.yaml]
 * @return {Stream}
 */
function importItems(str, url, options = {}) {
  const concurrency = options.concurrency || DEFAULT_CONCURRENCY,
    key = config.get('key', options.key),
    prefix = config.get('url', url);

  if (!prefix) {
    // exit early if there's no url
    return h.of({ type: 'error', message: 'URL is not defined! Please specify a site prefix to import to' });
  }

  if (options.yaml) {
    // parse bootstraps
    return (_.isString(str) ? h.of(str) : h(str))
      .splitBy(/\n==> .*? <==\n/ig) // tail -n +1 [file1 file2 ...] | clay import
      .filter((chunk) => chunk && chunk !== '\n')
      .flatMap((str) => {
        // split yaml bootstraps by duplicate root keys (e.g. _components),
        // allowing us to pipe in large numbers of bootstraps without worrying
        // about duplicate keys
        const lines = split(str, { preserveNewlines: true }),
          bootstraps = _.reduce(lines, (bootstraps, line) => {
            const rootProps = [
              '_components:\n',
              '_pages:\n',
              '_users:\n',
              '_uris:\n',
              '_lists:\n',
              '_layouts:\n'
            ];

            if (_.includes(rootProps, line)) {
              // split line into a new bootstrap
              bootstraps.push(line);
            } else {
              // add current line to the currently latest bootstrap
              bootstraps[bootstraps.length - 1] += line;
            }
            return bootstraps;
          }, ['']);

        return h(bootstraps);
      })
      .map(yaml.safeLoad)
      .errors((e, push) => {
        push(null, { type: 'error', message: `YAML syntax error: ${e.message.slice(0, e.message.indexOf(':'))}` });
      })
      .filter((chunk) => !!chunk) // filter out emptiness
      .map((obj) => {
        if (obj.type && obj.type === 'error') {
          return h.of(obj); // pass through errors
        } else {
          return importBootstrap(obj, prefix, key, options);
        }
      }).parallel(concurrency);
  } else {
    // parse dispatches
    return (_.isString(str) ? h.of(str) : h(str))
      .split()
      .compact()
      .map((res) => {
        try {
          return JSON.parse(res);
        } catch (e) {
          try {
            yaml.safeLoad(str);
            // user accidentally tried to import dispatches from a yaml file!
            return { type: 'error', message: 'Cannot import dispatch from yaml', details: 'Please use the --yaml argument to import from bootstraps' };
          } catch (otherE) {
            // not yaml, some other issue
            return { type: 'error', message: `JSON syntax error: ${e.message}`, details: _.truncate(res) };
          }
        }
      })
      .map((obj) => {
        if (obj.type && obj.type === 'error') {
          return h.of(obj); // pass through errors
        } else {
          return importDispatch(obj, prefix, key, options);
        }
      }).parallel(concurrency);
  }
}

/**
 * parse string of bootstraps,
 * returning a stream of prefixed dispatches
 * @param  {string} str bootstrap
 * @param  {string} url
 * @return {Stream}
 */
function parseBootstrap(str, url) {
  const prefix = config.get('url', url);

  return h.of(str)
    .map(yaml.safeLoad)
    .errors((e, push) => push(new Error(`YAML syntax error: ${e.message.slice(0, e.message.indexOf(':'))}`)))
    .flatMap((obj) => formatting.toDispatch(h.of(obj)))
    .flatMap((dispatch) => prefixes.add(dispatch, prefix));
}

/**
 * parse string of dispatches,
 * returning a string of prefixed dispatches
 * @param  {string} str
 * @param  {string} url
 * @return {Stream}
 */
function parseDispatch(str, url) {
  const prefix = config.get('url', url);

  return h.of(str)
    .split()
    .compact()
    .map(JSON.parse)
    .errors((e, push) => push(new Error(`JSON parser error: ${e.message}`)))
    .flatMap((dispatch) => prefixes.add(dispatch, prefix));
}

/**
 * parse a json object that is a direct translation
 * of a bootstrap yaml file returning a string
 * of prefixed dispatches
 * @param  {object} obj
 * @param  {string} url
 * @return {Stream}
 */
function parseBootstrapObject(obj, url) {
  const prefix = config.get('url', url);

  return h.of(obj)
    .flatMap(obj => formatting.toDispatch(h.of(obj)))
    .flatMap(dispatch => prefixes.add(dispatch, prefix));
}

module.exports = importItems;
module.exports.parseBootstrap = parseBootstrap;
module.exports.parseDispatch = parseDispatch;
module.exports.parseBootstrapObject = parseBootstrapObject;

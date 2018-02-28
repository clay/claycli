'use strict';
const _ = require('lodash'),
  h = require('highland'),
  utils = require('clayutils'),
  config = require('./config'),
  prefixes = require('../prefixes'),
  rest = require('../rest'),
  refProp = '_ref',
  DEFAULT_CONCURRENCY = 10,
  CONCURRENCY_TIME = 100;

/**
 * expand references in component lists
 * @param  {array} val
 * @return {array}
 */
function expandListReferences(val) {
  if (_.has(_.head(val), refProp)) {
    // component list! return the references
    return _.map(val, (item) => item[refProp]);
  } else {
    return [];
  }
}

/**
 * expand references in component properties
 * @param  {object} val
 * @return {array}
 */
function expandPropReferences(val) {
  if (_.has(val, refProp)) {
    return [val[refProp]];
  } else {
    return [];
  }
}

/**
 * list all references in a component
 * @param  {object} data
 * @return {array} of uris
 */
function listComponentReferences(data) {
  return _.reduce(data, (result, val) => {
    if (_.isArray(val)) {
      return result.concat(expandListReferences(val));
    } else if (_.isObject(val)) {
      return result.concat(expandPropReferences(val));
    } else {
      return result;
    }
  }, []);
}

/**
 * push rest errors into the stream
 * @param  {Error} err
 * @param  {function} push
 */
function pushRestError(err, push) {
  push(null, { result: 'error', url: err.url }); // every url that errors out should be captured
}

/**
 * recursively check all references in a component
 * @param  {*} url
 * @param {string} prefix
 * @param  {number} concurrency
 * @return {Stream}
 */
function checkComponent(url, prefix, concurrency) {
  if (_.isObject(url)) {
    return h.of(url); // error / success object, pass it on
  } else if (_.isString(url) && !_.includes(url, 'http')) {
    // uri, convert it to url
    url = prefixes.uriToUrl(prefix, url);
  }

  return rest.get(url)
    .flatMap((data) => {
      const children = listComponentReferences(data);

      return h([h.of({ result: 'success' }), h(children)]).merge();
    })
    .errors(pushRestError)
    .flatMap((uri) => checkComponent(uri, prefix))
    .ratelimit(concurrency, CONCURRENCY_TIME);
}

/**
 * check all references in a page
 * @param  {string} url
 * @param {string} prefix
 * @param  {number} concurrency
 * @return {Stream}
 */
function checkPage(url, prefix, concurrency) {
  return rest.get(url)
    .flatMap((data) => {
      const layout = data.layout,
        children = _.reduce(data, (uris, area) => _.isArray(area) ? uris.concat(area) : uris, []);

      return h([h.of({ result: 'success' }), h.of(layout), h(children)]).merge();
    })
    .errors(pushRestError)
    .flatMap((uri) => checkComponent(uri, prefix))
    .ratelimit(concurrency, CONCURRENCY_TIME);
}

/**
 * determine the page uri, then run checks against it
 * @param  {string} url
 * @param  {number} concurrency
 * @return {Stream}
 */
function checkPublicUrl(url, concurrency) {
  return rest.findURI(url)
    .flatMap((pageURI) => {
      const prefix = prefixes.getFromUrl(pageURI),
        pageURL = prefixes.uriToUrl(prefix, pageURI);

      return checkPage(pageURL, prefix, concurrency);
    }).errors(pushRestError);
}

/**
 * lint a url, recursively determining if all components exist
 * @param  {string} rawUrl url or alias, will be run through config
 * @param  {object} options
 * @return {Stream}
 */
function lintUrl(rawUrl, options = {}) {
  const concurrency = options.concurrency || DEFAULT_CONCURRENCY,
    url = config.get('url', rawUrl);

  if (utils.isComponent(url)) {
    return checkComponent(url, prefixes.getFromUrl(url), concurrency);
  } else if (utils.isPage(url)) {
    return checkPage(url, prefixes.getFromUrl(url), concurrency);
  } else {
    return checkPublicUrl(url, concurrency);
  }
}

module.exports.lintUrl = lintUrl;

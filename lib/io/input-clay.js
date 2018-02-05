'use strict';

const _ = require('lodash'),
  h = require('highland'),
  clayUtils = require('clay-utils'),
  b64 = require('base-64'),
  urlUtil = require('../utils/urls'),
  rest = require('../utils/rest'),
  config = require('../utils/config'),
  refProp = '_ref';

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
 * get list of instances in a component
 * @param  {string} prefix of site
 * @param  {string} name of component
 * @param {object} [options]
 * @param {number} [concurrency]
 * @param {object} [headers]
 * @param {boolean} [onlyPublished]
 * @return {Stream}
 */
function getComponentInstances(prefix, name, {concurrency, headers, onlyPublished} = {}) {
  return rest.get(`${prefix}/components/${name}/instances${onlyPublished ? '/@published' : ''}`, {
    concurrency,
    headers
  });
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
 * check a if a single component uri exists
 * @param {number} concurrency
 * @param {string} prefix
 * @param  {string|object} url or error object
 * @return {Stream} of { result: 'success or error', url (if error) }
 */
function checkReference(concurrency, prefix, url) {
  if (!_.isString(url)) {
    // error / success object, pass it on
    return h([url]);
  }

  // make sure url is using the correct prefix
  url = urlUtil.uriToUrl(prefix, url);

  // todo: when HEAD requests are supported in amphora, simply call rest.check(url)
  return rest.get(url, {concurrency})
    .map(() => ({ result: 'success' }))
    // we don't care about data, but we want the resulting stream's length
    // to be the number of urls we've checked
    .errors(pushRestError);
};

/**
 * check if an array of component references exist,
 * recursively checking references in each component
 * @param {number} concurrency
 * @param {string} prefix
 * @param  {array|string|object} uris, single uri, or error object
 * @return {Stream} of { result: 'success or error', url (if error) }
 */
function recursivelyCheckReference(concurrency, prefix, uris) {
  let urls;

  if (_.isArray(uris) && uris.length) {
    urls = _.map(uris, (uri) => urlUtil.uriToUrl(prefix, uri));
  } else if (_.isString(uris)) {
    urls = [urlUtil.uriToUrl(prefix, uris)];
  } else {
    // error / success object, pass it on
    return h([uris]);
  }

  return rest.get(urls, {concurrency})
    .flatMap((data) => {
      const childUris = listComponentReferences(data); // adding prefix when passed in recursively, so you don't need to do that here

      if (childUris.length) {
        return h([h.of({ result: 'success' }), recursivelyCheckReference(concurrency, prefix, childUris)]).merge();
      } else {
        return h.of({ result: 'success' });
      }
    }).errors(pushRestError);
}

/**
 * check all references in a component,
 * and (if recursive) all the children of that component
 * @param  {string} url
 * @param {string} prefix
 * @param {boolean} [isRecursive]
 * @param {number} concurrency
 * @return {Stream} of { result: 'success or error', url (if error) }
 */
function checkComponent(url, prefix, isRecursive, concurrency) {
  const stream = rest.get(url, {concurrency})
    .flatMap((data) => {
      const childUris = listComponentReferences(data);

      return h([h.of({ result: 'success' }), h(childUris)]).merge();
    }).errors(pushRestError);

  if (isRecursive) {
    return stream.flatMap(recursivelyCheckReference.bind(null, concurrency, prefix));
  } else {
    return stream.flatMap(checkReference.bind(null, concurrency, prefix));
  }
}

/**
 * check all references in a page,
 * and (if recursive) all the children of the components in the page
 * @param  {string} url
 * @param {string} prefix
 * @param {boolean} [isRecursive]
 * @param {number} concurrency
 * @return {Stream} of { result: 'success or error', url (if error) }
 */
function checkPage(url, prefix, isRecursive, concurrency) {
  const stream = rest.get(url, {concurrency})
    .flatMap((data) => {
      const layoutUri = data.layout,
        otherComponentUris = _.reduce(data, (uris, area) => {
          if (_.isArray(area)) {
            return uris.concat(area);
          } else {
            return uris;
          }
        }, []);

      return h([h.of({ result: 'success' }), h([layoutUri].concat(otherComponentUris))]).merge();
    }).errors(pushRestError);

  if (isRecursive) {
    return stream.flatMap(recursivelyCheckReference.bind(null, concurrency, prefix));
  } else {
    return stream.flatMap(checkReference.bind(null, concurrency, prefix));
  }
}

/**
 * check if a public url exists, then check the references in its page
 * and (if recursive) all the children of the components in the page
 * @param  {string} url
 * @param {string} prefix
 * @param {boolean} [isRecursive]
 * @param {number} concurrency
 * @return {Stream} of { result: 'success or error', url (if error) }
 */
function checkPublicUrl(url, prefix, isRecursive, concurrency) {
  let publicUrl;

  if (!prefix) {
    return h.fromError(new Error('Site prefix is required to check public urls!'));
  }

  publicUrl = `${prefix}/uris/${b64.encode(urlUtil.urlToUri(url))}`;
  return rest.get(publicUrl, {concurrency})
    .flatMap((pageUri) => {
      const pageUrl = urlUtil.uriToUrl(prefix, pageUri);

      return checkPage(pageUrl, prefix, isRecursive, concurrency);
    }).errors(pushRestError);
}

/**
 * check all references in a component,
 * and (if recursive) all the children of that component
 * @param  {string} uri
 * @param {boolean} [isRecursive]
 * @param {string} [prefix]
 * @param {number} concurrency
 * @return {Stream} of { result: 'success or error', url (if error) }
 */
function checkAllReferences(uri, isRecursive, prefix, concurrency) {
  const url = config.normalizeSite(uri);

  // uris use a passed-in prefix (so it can send back a nice error if they don't specify it),
  // whereas components and pages grab the prefix from the root url we're checking
  if (clayUtils.isComponent(url)) {
    return checkComponent(url, urlUtil.getUrlPrefix(url).prefix, isRecursive, concurrency);
  } else if (clayUtils.isPage(url)) {
    return checkPage(url, urlUtil.getUrlPrefix(url).prefix, isRecursive, concurrency);
  } else {
    return checkPublicUrl(url, prefix, isRecursive, concurrency);
  }
}

/**
 * get composed component data
 * @param  {number} concurrency
 * @param  {string} url
 * @return {[type]}             [description]
 */
function getDeepComponent(concurrency, url) {
  return rest.get(`${url}.json`, {concurrency})
    .map((data) => ({ url, data }));
}
/**
 * get page data, and its composed child components
 * @param  {number} concurrency
 * @param  {string} url
 * @return {Stream}
 */
function getDeepPage(concurrency, url) {
  const prefix = urlUtil.getUrlPrefix(url).prefix;

  return rest.get(url, {concurrency})
    .flatMap((pageData) => {

      // remove reserved properties that aren't URIs or URI arrays
      pageData = _.omit(pageData, ['url', 'urlHistory', 'customUrl', 'lastModified', 'priority', 'changeFrequency']);

      const childUrls = _.reduce(pageData, (uris, area) => {
        if (_.isArray(area)) {
          return uris.concat(area);
        } else {
          return uris;
        }
      }, [pageData.layout]).map(urlUtil.uriToUrl.bind(null, prefix));

      return h([
        h.of({ url, data: pageData }), // page data sent as object
        h(childUrls).flatMap(getDeepComponent.bind(null, concurrency))
      ]).merge();
    });
}

/**
 * import clay data from a url
 * @param  {string} url
 * @param  {number} concurrency
 * @return {Stream} of objects with { url, data: stringified json }
 */
function importUrl(url, concurrency) {
  if (clayUtils.isComponent(url)) {
    return getDeepComponent(concurrency, url);
  } else if (clayUtils.isPage(url)) {
    return getDeepPage(concurrency, url);
  } else {
    return h.fromError(new Error(`Unable to GET ${url}: Not a page or component!`));
  }
}

module.exports.getComponentInstances = getComponentInstances;
module.exports.listComponentReferences = listComponentReferences;
module.exports.checkAllReferences = checkAllReferences;
module.exports.importUrl = importUrl;

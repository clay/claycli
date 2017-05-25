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
 * @param {number} concurrency
 * @return {Stream}
 */
function getComponentInstances(prefix, name, concurrency) {
  return rest.get(`${prefix}/components/${name}/instances`, concurrency);
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
 * @param  {string|object} uri or error object
 * @return {Stream} of { result: 'success or error', url (if error) }
 */
function checkReference(concurrency, uri) {
  let url;

  if (!_.isString(uri)) {
    return h([uri]);
  }

  url = config.normalizeSite(uri);

  // todo: when HEAD requests are supported in amphora, simply call rest.check(url)
  return rest.get(url, concurrency)
    .map(() => ({ result: 'success' }))
    // we don't care about data, but we want the resulting stream's length
    // to be the number of urls we've checked
    .errors(pushRestError);
};

/**
 * check if an array of component references exist,
 * recursively checking references in each component
 * @param {number} concurrency
 * @param  {array|string|object} uris, single uri, or error object
 * @return {Stream} of { result: 'success or error', url (if error) }
 */
function recursivelyCheckReference(concurrency, uris) {
  let urls;

  if (_.isArray(uris) && uris.length) {
    urls = _.map(uris, config.normalizeSite);
  } else if (_.isString(uris)) {
    urls = [config.normalizeSite(uris)];
  } else {
    return h([uris]);
  }

  return rest.get(urls, concurrency)
    .flatMap((data) => {
      const childUris = listComponentReferences(data);

      if (childUris.length) {
        return h([h.of({ result: 'success' }), recursivelyCheckReference(concurrency, childUris)]).merge();
      } else {
        return h.of({ result: 'success' });
      }
    }).errors(pushRestError);
}

/**
 * check all references in a component,
 * and (if recursive) all the children of that component
 * @param  {string} url
 * @param {boolean} [isRecursive]
 * @param {number} concurrency
 * @return {Stream} of { result: 'success or error', url (if error) }
 */
function checkComponent(url, isRecursive, concurrency) {
  const stream = rest.get(url, concurrency)
    .flatMap((data) => {
      const childUris = listComponentReferences(data);

      return h([h.of({ result: 'success' }), h(childUris)]).merge();
    }).errors(pushRestError);

  if (isRecursive) {
    return stream.flatMap(recursivelyCheckReference.bind(null, concurrency));
  } else {
    return stream.flatMap(checkReference.bind(null, concurrency));
  }
}

/**
 * check all references in a page,
 * and (if recursive) all the children of the components in the page
 * @param  {string} url
 * @param {boolean} [isRecursive]
 * @param {number} concurrency
 * @return {Stream} of { result: 'success or error', url (if error) }
 */
function checkPage(url, isRecursive, concurrency) {
  const stream = rest.get(url, concurrency)
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
    return stream.flatMap(recursivelyCheckReference.bind(null, concurrency));
  } else {
    return stream.flatMap(checkReference.bind(null, concurrency));
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
  return rest.get(publicUrl, concurrency, 'text')
    .flatMap((pageUri) => {
      const pageUrl = config.normalizeSite(pageUri);

      return checkPage(pageUrl, isRecursive, concurrency);
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

  if (clayUtils.isComponent(url)) {
    return checkComponent(url, isRecursive, concurrency);
  } else if (clayUtils.isPage(url)) {
    return checkPage(url, isRecursive, concurrency);
  } else {
    return checkPublicUrl(url, prefix, isRecursive, concurrency);
  }
}

module.exports.getComponentInstances = getComponentInstances;
module.exports.listComponentReferences = listComponentReferences;
module.exports.checkAllReferences = checkAllReferences;

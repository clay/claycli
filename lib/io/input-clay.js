const _ = require('lodash'),
  h = require('highland'),
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
 * @return {Stream}
 */
function getComponentInstances(prefix, name) {
  return rest.get(`${prefix}/components/${name}/instances`);
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
 * @param  {string|object} uri or error object
 * @return {Stream} of { result: 'success or error', url (if error) }
 */
function checkReference(uri) {
  let url;

  if (!_.isString(uri)) {
    return h([uri]);
  }

  url = config.normalizeSite(uri);

  // todo: when HEAD requests are supported in amphora, simply call rest.check(url)
  return rest.get(url)
    .map(() => ({ result: 'success' }))
    // we don't care about data, but we want the resulting stream's length
    // to be the number of urls we've checked
    .errors(pushRestError);
};

/**
 * check if an array of component references exist,
 * recursively checking references in each component
 * @param  {array|string|object} uris, single uri, or error object
 * @return {Stream} of { result: 'success or error', url (if error) }
 */
function recursivelyCheckReference(uris) {
  let urls;

  if (_.isArray(uris) && uris.length) {
    urls = _.map(uris, config.normalizeSite);
  } else if (_.isString(uris)) {
    urls = [config.normalizeSite(uris)];
  } else {
    return h([uris]);
  }

  return rest.get(urls)
    .flatMap((data) => {
      const childUris = listComponentReferences(data);

      if (childUris.length) {
        return h([h.of({ result: 'success' }), recursivelyCheckReference(childUris)]).merge();
      } else {
        return h.of({ result: 'success' });
      }
    }).errors(pushRestError);
}

/**
 * check all references in a component,
 * and (if recursive) all the children of that component
 * @param  {string} uri
 * @param {boolean} isRecursive
 * @return {Stream} of { result: 'success or error', url (if error) }
 */
function checkAllReferences(uri, isRecursive) {
  const url = config.normalizeSite(uri),
    stream = rest.get(url)
      .flatMap((data) => {
        const childUris = listComponentReferences(data);

        return h([h.of({ result: 'success' }), h(childUris)]).merge();
      })
      .errors(pushRestError);

  if (isRecursive) {
    return stream.flatMap(recursivelyCheckReference);
  } else {
    return stream.flatMap(checkReference);
  }
}

module.exports.getComponentInstances = getComponentInstances;
module.exports.listComponentReferences = listComponentReferences;
module.exports.checkAllReferences = checkAllReferences;

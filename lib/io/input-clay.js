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
module.exports.getComponentInstances = (prefix, name) => {
  return rest.get(`${prefix}/components/${name}/instances`);
};

/**
 * list component references
 * @param  {object} data
 * @return {array} of uris
 */
module.exports.listComponentReferences = (data) => {
  return _.reduce(data, (result, val) => {
    if (_.isArray(val)) {
      return result.concat(expandListReferences(val));
    } else if (_.isObject(val)) {
      return result.concat(expandPropReferences(val));
    } else {
      return result;
    }
  }, []);
};

/**
 * check a single reference in a component
 * @param  {string} uri
 * @return {Stream}
 */
function checkReference(uri) {
  const url = config.normalizeSite(uri);

  // todo: when HEAD requests are supported in amphora, simply call rest.check(url)
  return rest.get(url)
    .map(() => ({ result: 'success' }))
    // we don't care about data, but we want the resulting stream's length
    // to be the number of urls we've checked
    .errors((err, push) => { // eslint-disable-line
      push(null, { result: 'error', url }); // every url that errors out should be captured
    });
};

function recursivelyCheckReference(uris) {
  const urls = _.map(uris, config.normalizeSite);

  return rest.get(urls)
    .flatMap((data) => {
      const childUris = module.exports.listComponentReferences(data);

      return h([h.of({ result: 'success' }), recursivelyCheckReference(childUris)]).merge();
    }).errors((err, push) => {
      push(null, { result: 'error', url: err.url });
    });
}

/**
 * check all references in a component, and all the children of that component
 * @param  {string} uri
 * @param {boolean} isRecursive
 * @return {Stream}
 */
module.exports.checkAllReferences = (uri, isRecursive) => {
  const url = config.normalizeSite(uri);

  if (isRecursive) {
    return rest.get(url)
      .map(module.exports.listComponentReferences)
      .flatMap(recursivelyCheckReference);
  } else {
    return rest.get(url)
      .flatMap(module.exports.listComponentReferences)
      .flatMap(checkReference);
  }
};

const _ = require('lodash'),
  bluebird = require('bluebird'),
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
module.exports.checkReference = (uri) => {
  const url = config.normalizeSite(uri);

  // todo: when HEAD requests are supported in amphora, simply call rest.check(url)
  return rest.get(url)
    .map(() => false) // we don't care about data, but errors will ignore this
    .errors((err, push) => { // eslint-disable-line
      push(null, url);
    });
};

/**
 * check all references in a component, and all the children of that component
 * @param  {array} missing
 * @param  {string} uri
 * @return {Promise}
 */
module.exports.recursivelyCheckReferences = (missing, uri) => {
  const url = config.normalizeSite(uri);

  return rest.get(url).then((data) => {
    const childRefs = module.exports.listComponentReferences(data);

    missing.push(false); // we compact these when linting, but we want to keep track of the number of refs we're checking
    return bluebird.reduce(childRefs, module.exports.recursivelyCheckReferences, missing);
  }).catch(() => {
    // uri doesn't exist! add it to the list
    missing.push(uri);
    return missing;
  });
};

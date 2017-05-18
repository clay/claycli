const _ = require('lodash'),
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

module.exports.checkReference = (uri) => {
  const url = config.normalizeSite(uri);

  return rest.get(url).then(() => false).catch(() => url);
};

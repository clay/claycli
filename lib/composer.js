'use strict';

const _ = require('lodash'),
  utils = require('clayutils'),
  refProp = '_ref';

/**
 * normalize a potential component list
 * @param  {array} arr which may be component list or just data
 * @return {array}
 */
function normalizeComponentList(arr) {
  if (_.has(_.head(arr), refProp)) {
    // it's a component list! only return the references
    return _.map(arr, (item) => _.pick(item, refProp));
  } else {
    // just component data, move along
    return arr;
  }
}

/**
 * normalize a potential component property
 * @param  {object} obj which may be a component prop or just data
 * @return {object}
 */
function normalizeComponentProp(obj) {
  if (_.has(obj, refProp)) {
    // it's a component prop! only return the reference
    return { [refProp]: obj[refProp] };
  } else {
    // just component data, move along
    return obj;
  }
}

/**
 * remove child component data, leaving only their references
 * note: this removes _ref from the root of component data
 * @param  {object} data for a component
 * @return {object}
 */
function normalize(data) {
  let cleanData = {};

  _.forOwn(data, (val, key) => {
    if (_.isArray(val)) {
      // possibly a component list
      cleanData[key] = normalizeComponentList(val);
    } else if (_.isObject(val)) {
      // possibly a component prop
      cleanData[key] = normalizeComponentProp(val);
    } else if (key !== refProp) {
      // add any other bits of component data
      cleanData[key] = val;
    }
  });

  return cleanData;
}

function addComponent(item, bootstrap, added) {
  const uri = item[refProp],
    name = utils.getComponentName(uri),
    instance = utils.getComponentInstance(uri),
    data = instance ? _.get(bootstrap, `_components.${name}.instances.${instance}`) : _.omit(_.get(bootstrap, `_components.${name}`), 'instances');

  if (!data || !_.size(data)) {
    return item; // just return the _ref, since it doesn't point to any data we currently have
    // note: there might already be data in the database, or elsewhere
  } else {
    // if we've found the component, add its data and mark it as added
    _.set(added, `asChild['${uri}']`, true);
    added[uri] = true;
    return _.assign(item, denormalize(data, bootstrap, added)); // recursion excursion!
  }
}

/**
 * denormalize a potential component list
 * @param  {array} arr which may be component list or just data
 * @param {object} bootstrap containing all components
 * @param {object} added
 * @return {array}
 */
function denormalizeComponentList(arr, bootstrap, added) {
  if (_.has(_.head(arr), refProp)) {
    // it's a component list! grab the data from the bootstrap
    return _.map(arr, (item) => addComponent(item, bootstrap, added));
  } else {
    // just component data, move along
    return arr;
  }
}

/**
 * denormalize a potential component prop
 * @param  {object} obj which may be component prop or just data
 * @param {object} bootstrap containing all components
 * @param {object} added
 * @return {array}
 */
function denormalizeComponentProp(obj, bootstrap, added) {
  if (_.has(obj, refProp)) {
    // it's a component prop! grab the data from the bootstrap
    return addComponent(obj, bootstrap, added);
  } else {
    // just component data, move along
    return obj;
  }
}

/**
 * add child component data to their references,
 * and update a list of added components
 * note: this is similar to how amphora composes json
 * @param  {object} data for a component
 * @param {object} bootstrap containing all components
 * @param {object} added
 * @return {object}
 */
function denormalize(data, bootstrap, added) {
  _.forOwn(data, (val, key) => {
    if (_.isArray(val)) {
      // possibly a component list
      data[key] = denormalizeComponentList(val, bootstrap, added);
    } else if (_.isObject(val)) {
      // possibly a component prop
      data[key] = denormalizeComponentProp(val, bootstrap, added);
    } else {
      // add any other bits of component data
      data[key] = val;
    }
  });

  return data;
}

module.exports.normalize = normalize;
module.exports.denormalize = denormalize;

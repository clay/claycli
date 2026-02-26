import _ from 'lodash';

const utils = require('clayutils');

const refProp = '_ref';

interface ComponentRef {
  [refProp]: string;
  [key: string]: unknown;
}

interface Bootstrap {
  _components: Record<string, Record<string, unknown>>;
  [key: string]: unknown;
}

interface AddedTracker {
  asChild?: Record<string, boolean>;
  [key: string]: unknown;
}

/**
 * normalize a potential component list
 */
function normalizeComponentList(arr: unknown[]): unknown[] {
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
 */
function normalizeComponentProp(obj: Record<string, unknown>): Record<string, unknown> {
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
 */
function normalize(data: Record<string, unknown>): Record<string, unknown> {
  const cleanData: Record<string, unknown> = {};

  _.forOwn(data, (val, key) => {
    if (_.isArray(val)) {
      // possibly a component list
      cleanData[key] = normalizeComponentList(val);
    } else if (_.isObject(val)) {
      // possibly a component prop
      cleanData[key] = normalizeComponentProp(val as Record<string, unknown>);
    } else if (key !== refProp) {
      // add any other bits of component data
      cleanData[key] = val;
    }
  });

  return cleanData;
}

function addComponent(
  item: ComponentRef,
  bootstrap: Bootstrap,
  added: AddedTracker
): ComponentRef {
  const uri = item[refProp],
    name = utils.getComponentName(uri),
    instance = utils.getComponentInstance(uri),
    data: Record<string, unknown> | undefined = instance
      ? _.get(bootstrap, `_components.${name}.instances.${instance}`) as Record<string, unknown> | undefined
      : _.omit(_.get(bootstrap, `_components.${name}`) as Record<string, unknown>, 'instances') as Record<string, unknown>;

  if (!data || !_.size(data)) {
    return item; // just return the _ref, since it doesn't point to any data we currently have
    // note: there might already be data in the database, or elsewhere
  } else {
    // if we've found the component, add its data and mark it as added
    _.set(added, `asChild['${uri}']`, true);
    (added as Record<string, unknown>)[uri] = true;
    return _.assign(item, denormalize(data, bootstrap, added)); // recursion excursion!
  }
}

/**
 * denormalize a potential component list
 */
function denormalizeComponentList(
  arr: unknown[],
  bootstrap: Bootstrap,
  added: AddedTracker
): unknown[] {
  if (_.has(_.head(arr), refProp)) {
    // it's a component list! grab the data from the bootstrap
    return _.map(arr, (item) => addComponent(item as ComponentRef, bootstrap, added));
  } else {
    // just component data, move along
    return arr;
  }
}

/**
 * denormalize a potential component prop
 */
function denormalizeComponentProp(
  obj: Record<string, unknown>,
  bootstrap: Bootstrap,
  added: AddedTracker
): Record<string, unknown> {
  if (_.has(obj, refProp)) {
    // it's a component prop! grab the data from the bootstrap
    return addComponent(obj as ComponentRef, bootstrap, added);
  } else {
    // just component data, move along
    return obj;
  }
}

/**
 * add child component data to their references,
 * and update a list of added components
 * note: this is similar to how amphora composes json
 */
function denormalize(
  data: Record<string, unknown>,
  bootstrap: Bootstrap,
  added: AddedTracker
): Record<string, unknown> {
  _.forOwn(data, (val, key) => {
    if (_.isArray(val)) {
      // possibly a component list
      data[key] = denormalizeComponentList(val, bootstrap, added);
    } else if (_.isObject(val)) {
      // possibly a component prop
      data[key] = denormalizeComponentProp(val as Record<string, unknown>, bootstrap, added);
    } else {
      // add any other bits of component data
      data[key] = val;
    }
  });

  return data;
}

export { normalize, denormalize };

'use strict';
const h = require('highland'),
  _ = require('lodash'),
  b64 = require('base-64'),
  utils = require('clayutils'),
  composer = require('./composer'),
  deepReduce = require('./deep-reduce'),
  types = require('./types');

/**
 * get uri from dispatch
 * @param  {object} dispatch
 * @return {string}
 */
function getDispatchURI(dispatch) {
  return Object.keys(dispatch)[0];
}

/* convert dispatches to bootstraps, and vice versa
 * dispatch looks like: {"/_components/article/instances/foo":{"title":"My Article","content": [{"_ref":"/_components/paragraph/instances/bar","text":"lorem ipsum"}]}}
 * bootstrap looks like:
 * _components:
 *   article:
 *     instances:
 *       foo:
 *         title: My Article
 *         content:
 *           - _ref: /_components/paragraph/instances/bar
 *   paragraph:
 *     instances:
 *       bar:
 *         text: lorem ipsum
 */

/**
 * create dispatches from component defaults and instances,
 * then deduplicate if any child components have dispatches of their own already
 * @param  {array} dispatches e.g. [{ unprefixed ref: composed data }]
 * @param  {object} components
 * @param  {object} bootstrap obj to refer to
 * @param  {object} added obj to check if components have been added already
 * @return {array} of dispatches
 */
function parseComponentBootstrap(dispatches, components, { bootstrap, added }) {
  return _.reduce(components, (dispatches, data, name) => {
    const defaultData = _.omit(data, 'instances'),
      defaultURI = `/_components/${name}`;

    // first, compose and add the default data if it hasn't already been added
    if (_.size(defaultData) && !added[defaultURI]) {
      dispatches.push({ [defaultURI]: composer.denormalize(defaultData, bootstrap, added) });
      added[defaultURI] = true;
    }

    // second, compose and add instances if they haven't already been added
    if (data.instances && _.size(data.instances)) {
      _.forOwn(data.instances, (instanceData, instance) => {
        const instanceURI = `/_components/${name}/instances/${instance}`;

        if (!added[instanceURI]) {
          dispatches.push({ [instanceURI]: composer.denormalize(instanceData, bootstrap, added) });
          added[instanceURI] = true;
        }
      });
    }

    // then remove any dispatches that are actually children of other components
    return _.filter(dispatches, (dispatch) => !_.get(added, `asChild[${getDispatchURI(dispatch)}]`));
  }, dispatches);
}

/**
 * create dispatches from page data
 * note: these pages are not composed
 * @param  {array} dispatches
 * @param  {object} pages
 * @return {array}
 */
function parsePageBootstrap(dispatches, pages) {
  return _.reduce(pages, (dispatches, page, id) => {
    if (id[0] === '/') {
      // if a page starts with a slash, remove it so we can generate the uri
      id = id.slice(1);
    }

    // unpublished pages should not have 'url', but rather 'customUrl'
    if (page.url && !page.customUrl) {
      page.customUrl = page.url;
      delete page.url; // don't pass this through
    }

    dispatches.push({ [`/_pages/${id}`]: page });
    return dispatches;
  }, dispatches);
}

/**
 * create dispatches from users
 * @param  {array} dispatches
 * @param  {array} users
 * @return {array}
 */
function parseUsersBootstrap(dispatches, users) {
  // note: dispatches match 1:1 with users
  return _.reduce(users, (dispatches, user) => {
    if (!user.username || !user.provider || !user.auth) {
      throw new Error('Cannot bootstrap users without username, provider, and auth level');
    } else {
      dispatches.push({ [`/_users/${b64.encode(user.username.toLowerCase() + '@' + user.provider)}`]: user });
    }
    return dispatches;
  }, dispatches);
}

/**
 * parse uris, lists, etc arbitrary data in bootstraps
 * @param  {array} dispatches
 * @param  {object|array} items
 * @param  {string} type
 * @return {array}
 */
function parseArbitraryBootstrapData(dispatches, items, type) {
  return _.reduce(items, (dispatches, item, key) => {
    if (key[0] === '/') {
      // fix for uris, which sometimes start with /
      key = key.slice(1);
    }
    dispatches.push({ [`/${type}/${key}`]: item });
    return dispatches;
  }, dispatches);
}

/**
 * compose bootstrap data
 * @param  {object} bootstrap
 * @return {Stream} of dispatches
 */
function parseBootstrap(bootstrap) {
  let added = { asChild: {} },
    dispatches = _.reduce(bootstrap, (dispatches, items, type) => {
      switch (type) {
        case '_components': return parseComponentBootstrap(dispatches, items, { bootstrap, added });
        case '_pages': return parsePageBootstrap(dispatches, items);
        case '_users': return parseUsersBootstrap(dispatches, items);
        default: return parseArbitraryBootstrapData(dispatches, items, type); // uris, lists
      }
    }, []);

  return h(dispatches);
}

/**
 * convert stream of bootstrap objects to dispatches
 * @param  {Stream} stream
 * @return {Stream}
 */
function toDispatch(stream) {
  return stream.flatMap(parseBootstrap);
}

/**
 * add deep component data to a bootstrap
 * @param {string} uri
 * @param  {object} dispatch
 * @param  {object} bootstrap
 * @return {object}
 */
function parseComponentDispatch(uri, dispatch, bootstrap) {
  const deepData = dispatch[uri],
    name = utils.getComponentName(uri),
    instance = utils.getComponentInstance(uri),
    path = instance ? `_components['${name}'].instances['${instance}']` : `_components['${name}']`;

  _.set(bootstrap, path, composer.normalize(deepData));

  return deepReduce(bootstrap, deepData, (ref, val) => {
    const deepName = utils.getComponentName(ref),
      deepInstance = utils.getComponentInstance(ref),
      deepPath = deepInstance ? `_components['${deepName}'].instances['${deepInstance}']` : `_components['${deepName}']`;

    _.set(bootstrap, deepPath, composer.normalize(val));
  });
}

/**
 * add page data to a bootstrap
 * @param {string} uri
 * @param  {object} dispatch
 * @param  {object} bootstrap
 * @return {object}
 */
function parsePageDispatch(uri, dispatch, bootstrap) {
  let id = utils.getPageInstance(uri),
    page = dispatch[uri];

  // unpublished pages should not have 'url', but rather 'customUrl'
  if (page.url && !page.customUrl) {
    page.customUrl = page.url;
    delete page.url; // don't pass this through
  }

  _.set(bootstrap, `_pages['${id}']`, page);
  return bootstrap;
}

/**
 * add user data to a bootstrap
 * @param {string} uri
 * @param  {object} dispatch
 * @param  {object} bootstrap
 * @return {object}
 */
function parseUsersDispatch(uri, dispatch, bootstrap) {
  if (!bootstrap._users) {
    bootstrap._users = [];
  }

  bootstrap._users.push(dispatch[uri]);
  return bootstrap;
}

/**
 * add uris, lists, etc arbitrary data to a bootstrap
 * @param {string} uri
 * @param  {object} dispatch
 * @param  {object} bootstrap
 * @return {object}
 */
function parseArbitraryDispatchData(uri, dispatch, bootstrap) {
  let type = _.find(types, (t) => _.includes(uri, t)),
    name = uri.split(`${type}/`)[1];

  type = type.slice(1); // remove beginning slash
  if (type === '_uris' && name[0] !== '/') {
    // fix for uris, which sometimes start with /
    name = `/${name}`;
  }

  _.set(bootstrap, `${type}['${name}']`, dispatch[uri]);
  return bootstrap;
}

/**
 * generate a bootstrap by reducing through a stream of dispatches
 * @param  {object} bootstrap
 * @param  {object} dispatch
 * @return {object}
 */
function generateBootstrap(bootstrap, dispatch) {
  const uri = getDispatchURI(dispatch),
    type = _.find(types, (t) => _.includes(uri, t));

  switch (type) {
    case '/_components': return parseComponentDispatch(uri, dispatch, bootstrap);
    case '/_pages': return parsePageDispatch(uri, dispatch, bootstrap);
    case '/_users': return parseUsersDispatch(uri, dispatch, bootstrap);
    default: return parseArbitraryDispatchData(uri, dispatch, bootstrap); // uris, lists
  }
}

/**
 * convert stream of dispatches to a bootstrap
 * @param  {Stream} stream
 * @return {Stream}
 */
function toBootstrap(stream) {
  return stream.reduce(generateBootstrap, {});
}

module.exports.toDispatch = toDispatch;
module.exports.toBootstrap = toBootstrap;

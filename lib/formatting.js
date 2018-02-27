'use strict';
const _ = require('lodash'),
  b64 = require('base-64'),
  composer = require('./composer'),
  log = require('./logger')(__filename);

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
    return _.filter(dispatches, (dispatch) => !_.get(added, `asChild[${Object.keys(dispatch)[0]}]`));
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
      log.warn('Cannot bootstrap users without username, provider, and auth level');
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

module.exports.toDispatch = toDispatch;

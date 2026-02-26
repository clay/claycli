'use strict';
const _ = require('lodash'),
  utils = require('clayutils'),
  formatting = require('../formatting'),
  prefixes = require('../prefixes'),
  config = require('./config'),
  rest = require('../rest'),
  { mapConcurrent } = require('../concurrency');

let layouts = []; // keep track of exported layouts, to dedupe the dispatches

/**
 * throw if result is an error
 * @param  {object|Error} item
 * @return {object}
 */
function toError(item) {
  if (item instanceof Error || _.isObject(item) && item.type === 'error') {
    throw item;
  } else {
    return item;
  }
}

/**
 * export single bit of arbitrary data
 * e.g. components, lists, users
 * @param  {string} url
 * @return {Promise<object>} dispatch (with prefix)
 */
async function exportSingleItem(url) {
  var res = await rest.get(url);

  toError(res);
  return { [prefixes.urlToUri(url)]: res };
}

/**
 * export single _uri
 * @param  {string} url
 * @return {Promise<object>} dispatch (with prefix)
 */
async function exportSingleURI(url) {
  var res = await rest.get(url, { type: 'text' });

  toError(res);
  return { [prefixes.urlToUri(url)]: res };
}

/**
 * export all instances of a component or layout
 * @param  {string} url
 * @param  {string} prefix
 * @param  {number} concurrency
 * @return {Promise<array>} dispatches
 */
async function exportInstances(url, prefix, concurrency) {
  var res = await rest.get(url);

  toError(res);
  return mapConcurrent(res, concurrency, (item) => {
    return exportSingleItem(`${prefixes.uriToUrl(prefix, item)}.json`);
  });
}

/**
 * export all instances of all components
 * @param  {string} url
 * @param  {string} prefix
 * @param  {number} concurrency
 * @return {Promise<array>} dispatches
 */
async function exportAllComponents(url, prefix, concurrency) {
  var res = await rest.get(url),
    allResults;

  toError(res);
  allResults = await mapConcurrent(res, concurrency, (item) => {
    return exportInstances(`${prefix}/_components/${item}/instances`, prefix, concurrency);
  });

  return _.flatten(allResults);
}

/**
 * export all instances of all layouts
 * @param  {string} url
 * @param  {string} prefix
 * @param  {number} concurrency
 * @return {Promise<array>} dispatches
 */
async function exportAllLayouts(url, prefix, concurrency) {
  var res = await rest.get(url),
    allResults;

  toError(res);
  allResults = await mapConcurrent(res, concurrency, (item) => {
    return exportInstances(`${prefix}/_layouts/${item}/instances`, prefix, concurrency);
  });

  return _.flatten(allResults);
}

/**
 * export single page
 * @param  {string} url
 * @param  {string} prefix
 * @param  {boolean} includeLayout
 * @param  {number} concurrency
 * @return {Promise<array>} dispatches
 */
async function exportSinglePage(url, prefix, includeLayout, concurrency) {
  var res = await rest.get(url), children, results;

  toError(res);
  children = _.reduce(res, (uris, area) => _.isArray(area) ? uris.concat(area) : uris, []);

  if (includeLayout && !_.includes(layouts, res.layout)) {
    children.push(res.layout);
    layouts.push(res.layout);
  }

  results = await mapConcurrent(children, concurrency, (child) => {
    return exportSingleItem(`${prefixes.uriToUrl(prefix, child)}.json`);
  });

  results.push({ [prefixes.urlToUri(url)]: res });
  return results;
}

/**
 * export all bits of arbitrary data
 * e.g. lists or users
 * @param  {string} url
 * @param  {string} prefix
 * @param  {number} concurrency
 * @return {Promise<array>} dispatches
 */
async function exportMultipleItems(url, prefix, concurrency) {
  var res = await rest.get(url);

  toError(res);
  return mapConcurrent(res, concurrency, (item) => {
    return exportSingleItem(prefixes.uriToUrl(prefix, item));
  });
}

/**
 * export all pages
 * @param  {string} url
 * @param  {string} prefix
 * @param  {boolean} includeLayout
 * @param  {number} concurrency
 * @return {Promise<array>} dispatches
 */
async function exportAllPages(url, prefix, includeLayout, concurrency) {
  var res = await rest.get(url),
    allResults;

  toError(res);
  allResults = await mapConcurrent(res, concurrency, (item) => {
    return exportSinglePage(prefixes.uriToUrl(prefix, item), prefix, includeLayout, concurrency);
  });

  return _.flatten(allResults);
}

/**
 * export all _uris
 * @param  {string} url
 * @param  {string} prefix
 * @param  {number} concurrency
 * @return {Promise<array>} dispatches
 */
async function exportMultipleURIs(url, prefix, concurrency) {
  var res = await rest.get(url);

  toError(res);
  return mapConcurrent(res, concurrency, (item) => {
    return exportSingleURI(prefixes.uriToUrl(prefix, item));
  });
}

/**
 * export public url
 * @param  {string} url
 * @param  {boolean} includeLayout
 * @param  {number} concurrency
 * @return {Promise<array>} dispatches
 */
async function exportPublicURL(url, includeLayout, concurrency) {
  var result = await rest.findURI(url), pageURL, pageDispatches;

  toError(result);
  pageURL = prefixes.uriToUrl(result.prefix, result.uri);
  pageDispatches = await exportSinglePage(pageURL, result.prefix, includeLayout, concurrency);

  return mapConcurrent(pageDispatches, concurrency, (dispatch) => {
    return prefixes.remove(dispatch, result.prefix);
  });
}

/**
 * generate dispatches from a single url
 * @param  {string} url
 * @param  {string} prefix
 * @param  {boolean} includeLayout
 * @param  {number} concurrency
 * @return {Promise<array>}
 */
function generateExportDispatches(url, prefix, includeLayout, concurrency) { // eslint-disable-line
  if (utils.isLayout(url) && utils.getLayoutName(url) && (utils.getLayoutInstance(url) || utils.isDefaultLayout(url)) || utils.isComponent(url) && utils.getComponentName(url) && (utils.getComponentInstance(url) || utils.isDefaultComponent(url))) {
    return exportSingleItem(`${url}.json`).then((d) => [d]);
  } else if (utils.getLayoutName(url) && !utils.getLayoutInstance(url) || utils.getComponentName(url) && !utils.getComponentInstance(url)) {
    return exportInstances(url, prefix, concurrency);
  } else if (_.includes(url, '_components')) {
    return exportAllComponents(url, prefix, concurrency);
  } else if (_.includes(url, '_layouts')) {
    return exportAllLayouts(url, prefix, concurrency);
  } else if (utils.isPage(url) && utils.getPageInstance(url)) {
    return exportSinglePage(url, prefix, includeLayout, concurrency);
  } else if (_.includes(url, '_pages')) {
    return exportAllPages(url, prefix, includeLayout, concurrency);
  } else if (url.match(/\/_?(uris)\/(.+)/)) {
    return exportSingleURI(url).then((d) => [d]);
  } else if (url.match(/\/_?(uris)$/)) {
    return exportMultipleURIs(url, prefix, concurrency);
  } else if (url.match(/\/_?(lists|users)\/(.+)/)) {
    return exportSingleItem(url).then((d) => [d]);
  } else if (url.match(/\/_?(lists|users)/)) {
    return exportMultipleItems(url, prefix, concurrency);
  } else {
    return exportPublicURL(url, includeLayout, concurrency);
  }
}

/**
 * export specific items from a single url
 * @param  {string} rawUrl
 * @param  {object} [options]
 * @return {Promise<array>} dispatches or single bootstrap
 */
async function fromURL(rawUrl, options) {
  var url, prefix, dispatches, concurrency, unprefixed;

  options = options || {};
  concurrency = options.concurrency || 10;
  url = config.get('url', rawUrl);

  if (!url) {
    let e = new Error('URL is not defined! Please specify a url to export from');

    e.url = 'undefined url';
    throw e;
  }

  try {
    prefix = prefixes.getFromUrl(url);
  } catch (_e) { // eslint-disable-line no-unused-vars
    prefix = null;
  }

  dispatches = await generateExportDispatches(url, prefix, options.layout, concurrency);
  unprefixed = await mapConcurrent(dispatches, concurrency, (dispatch) => {
    return prefixes.remove(dispatch, prefix);
  });

  if (options.yaml) {
    return [formatting.toBootstrap(unprefixed)];
  }
  return unprefixed;
}

/**
 * export items based on elastic query
 * @param  {string} rawUrl to elastic endpoint
 * @param  {object} [query]
 * @param  {object} [options]
 * @return {Promise<array>} dispatches or single bootstrap
 */
function fromQuery(rawUrl, query, options) {
  var key, prefix, fullQuery, concurrency;

  query = query || {};
  options = options || {};
  key = config.get('key', options.key);
  prefix = config.get('url', rawUrl);

  if (!prefix) {
    let e = new Error('URL is not defined! Please specify a site prefix to export from');

    e.url = 'undefined prefix';
    return Promise.reject(e);
  }

  fullQuery = _.assign({
    index: 'pages',
    size: 10,
    body: {
      query: {
        prefix: {
          uri: prefixes.urlToUri(prefix)
        }
      }
    }
  }, { size: options.size }, query);

  concurrency = options.concurrency || 10;

  // rest.query throws synchronously if no key
  return rest.query(`${prefix}/_search`, fullQuery, { key })
    .then(async (res) => {
      var allDispatches, dispatches, unprefixed;

      toError(res);
      allDispatches = await mapConcurrent(res.data, concurrency, (item) => {
        return generateExportDispatches(prefixes.uriToUrl(prefix, item._id), prefix, options.layout, concurrency);
      });

      dispatches = _.flatten(allDispatches);

      unprefixed = await mapConcurrent(dispatches, concurrency, (dispatch) => {
        return prefixes.remove(dispatch, prefix);
      });

      if (options.yaml) {
        return [formatting.toBootstrap(unprefixed)];
      }
      return unprefixed;
    });
}

/**
 * clear the layouts cache
 */
function clearLayouts() {
  layouts = [];
}

module.exports.fromURL = fromURL;
module.exports.fromQuery = fromQuery;
module.exports.clearLayouts = clearLayouts;

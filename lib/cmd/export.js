'use strict';
const _ = require('lodash'),
  utils = require('clayutils'),
  formatting = require('../formatting'),
  prefixes = require('../prefixes'),
  config = require('./config'),
  rest = require('../rest');

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
 * @return {Promise<array>} dispatches
 */
async function exportInstances(url, prefix) {
  var res = await rest.get(url), i, results = [];

  toError(res);
  for (i = 0; i < res.length; i++) {
    results.push(await exportSingleItem(`${prefixes.uriToUrl(prefix, res[i])}.json`));
  }
  return results;
}

/**
 * export all instances of all components
 * @param  {string} url
 * @param  {string} prefix
 * @return {Promise<array>} dispatches
 */
async function exportAllComponents(url, prefix) {
  var res = await rest.get(url), i, results = [], instances;

  toError(res);
  for (i = 0; i < res.length; i++) {
    instances = await exportInstances(`${prefix}/_components/${res[i]}/instances`, prefix);
    results = results.concat(instances);
  }
  return results;
}

/**
 * export all instances of all layouts
 * @param  {string} url
 * @param  {string} prefix
 * @return {Promise<array>} dispatches
 */
async function exportAllLayouts(url, prefix) {
  var res = await rest.get(url), i, results = [], instances;

  toError(res);
  for (i = 0; i < res.length; i++) {
    instances = await exportInstances(`${prefix}/_layouts/${res[i]}/instances`, prefix);
    results = results.concat(instances);
  }
  return results;
}

/**
 * export single page
 * @param  {string} url
 * @param  {string} prefix
 * @param  {boolean} includeLayout
 * @return {Promise<array>} dispatches
 */
async function exportSinglePage(url, prefix, includeLayout) {
  var res = await rest.get(url), i, results = [], children;

  toError(res);
  children = _.reduce(res, (uris, area) => _.isArray(area) ? uris.concat(area) : uris, []);

  if (includeLayout && !_.includes(layouts, res.layout)) {
    children.push(res.layout);
    layouts.push(res.layout);
  }

  for (i = 0; i < children.length; i++) {
    results.push(await exportSingleItem(`${prefixes.uriToUrl(prefix, children[i])}.json`));
  }
  results.push({ [prefixes.urlToUri(url)]: res });
  return results;
}

/**
 * export all bits of arbitrary data
 * e.g. lists or users
 * @param  {string} url
 * @param  {string} prefix
 * @return {Promise<array>} dispatches
 */
async function exportMultipleItems(url, prefix) {
  var res = await rest.get(url), i, results = [];

  toError(res);
  for (i = 0; i < res.length; i++) {
    results.push(await exportSingleItem(prefixes.uriToUrl(prefix, res[i])));
  }
  return results;
}

/**
 * export all pages
 * @param  {string} url
 * @param  {string} prefix
 * @param  {boolean} includeLayout
 * @return {Promise<array>} dispatches
 */
async function exportAllPages(url, prefix, includeLayout) {
  var res = await rest.get(url), i, results = [], pageResults;

  toError(res);
  for (i = 0; i < res.length; i++) {
    pageResults = await exportSinglePage(prefixes.uriToUrl(prefix, res[i]), prefix, includeLayout);
    results = results.concat(pageResults);
  }
  return results;
}

/**
 * export all _uris
 * @param  {string} url
 * @param  {string} prefix
 * @return {Promise<array>} dispatches
 */
async function exportMultipleURIs(url, prefix) {
  var res = await rest.get(url), i, results = [];

  toError(res);
  for (i = 0; i < res.length; i++) {
    results.push(await exportSingleURI(prefixes.uriToUrl(prefix, res[i])));
  }
  return results;
}

/**
 * export public url
 * @param  {string} url
 * @param  {boolean} includeLayout
 * @return {Promise<array>} dispatches
 */
async function exportPublicURL(url, includeLayout) {
  var result = await rest.findURI(url), i, pageURL, pageDispatches, unprefixed = [];

  toError(result);
  pageURL = prefixes.uriToUrl(result.prefix, result.uri);
  pageDispatches = await exportSinglePage(pageURL, result.prefix, includeLayout);

  for (i = 0; i < pageDispatches.length; i++) {
    unprefixed.push(await prefixes.remove(pageDispatches[i], result.prefix));
  }
  return unprefixed;
}

/**
 * generate dispatches from a single url
 * @param  {string} url
 * @param  {string} prefix
 * @param  {boolean} includeLayout
 * @return {Promise<array>}
 */
function generateExportDispatches(url, prefix, includeLayout) { // eslint-disable-line
  if (utils.isLayout(url) && utils.getLayoutName(url) && (utils.getLayoutInstance(url) || utils.isDefaultLayout(url)) || utils.isComponent(url) && utils.getComponentName(url) && (utils.getComponentInstance(url) || utils.isDefaultComponent(url))) {
    return exportSingleItem(`${url}.json`).then((d) => [d]);
  } else if (utils.getLayoutName(url) && !utils.getLayoutInstance(url) || utils.getComponentName(url) && !utils.getComponentInstance(url)) {
    return exportInstances(url, prefix);
  } else if (_.includes(url, '_components')) {
    return exportAllComponents(url, prefix);
  } else if (_.includes(url, '_layouts')) {
    return exportAllLayouts(url, prefix);
  } else if (utils.isPage(url) && utils.getPageInstance(url)) {
    return exportSinglePage(url, prefix, includeLayout);
  } else if (_.includes(url, '_pages')) {
    return exportAllPages(url, prefix, includeLayout);
  } else if (url.match(/\/_?(uris)\/(.+)/)) {
    return exportSingleURI(url).then((d) => [d]);
  } else if (url.match(/\/_?(uris)$/)) {
    return exportMultipleURIs(url, prefix);
  } else if (url.match(/\/_?(lists|users)\/(.+)/)) {
    return exportSingleItem(url).then((d) => [d]);
  } else if (url.match(/\/_?(lists|users)/)) {
    return exportMultipleItems(url, prefix);
  } else {
    return exportPublicURL(url, includeLayout);
  }
}

/**
 * export specific items from a single url
 * @param  {string} rawUrl
 * @param  {object} [options]
 * @return {Promise<array>} dispatches or single bootstrap
 */
async function fromURL(rawUrl, options) {
  var url, prefix, dispatches, i, unprefixed;

  options = options || {};
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

  dispatches = await generateExportDispatches(url, prefix, options.layout);
  unprefixed = [];
  for (i = 0; i < dispatches.length; i++) {
    unprefixed.push(await prefixes.remove(dispatches[i], prefix));
  }

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
  var key, prefix, fullQuery;

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

  // rest.query throws synchronously if no key
  return rest.query(`${prefix}/_search`, fullQuery, { key })
    .then(async (res) => {
      var i, dispatches = [], unprefixed = [], itemDispatches;

      toError(res);
      for (i = 0; i < res.data.length; i++) {
        itemDispatches = await generateExportDispatches(prefixes.uriToUrl(prefix, res.data[i]._id), prefix, options.layout);
        dispatches = dispatches.concat(itemDispatches);
      }
      for (i = 0; i < dispatches.length; i++) {
        unprefixed.push(await prefixes.remove(dispatches[i], prefix));
      }
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

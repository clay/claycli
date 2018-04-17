'use strict';
const _ = require('lodash'),
  h = require('highland'),
  utils = require('clayutils'),
  formatting = require('../formatting'),
  prefixes = require('../prefixes'),
  config = require('./config'),
  rest = require('../rest'),
  DEFAULT_CONCURRENCY = 10,
  CONCURRENCY_TIME = 100;

let layouts = []; // keep track of exported layouts, to dedupe the dispatches

/**
 * throw errors in the same place they can be dealt with
 * note: in the programmatic api, you need to handle errors yourself
 * because the stream will be pure data
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
 * @return {Stream} of dispatches (with prefix)
 */
function exportSingleItem(url) {
  return rest.get(url).map(toError).map((res) => ({ [prefixes.urlToUri(url)]: res }));
}

/**
 * export all instances of a component
 * @param  {string} url
 * @param  {string} prefix
 * @return {Stream} of dispatches (with prefix)
 */
function exportComponentInstances(url, prefix) {
  return rest.get(url).map(toError).flatMap((res) => {
    return h(_.map(res, (uri) => exportSingleItem(`${prefixes.uriToUrl(prefix, uri)}.json`))).flatten();
  });
}

/**
 * export all instances of all components
 * @param  {string} url
 * @param  {string} prefix
 * @return {Stream} of dispatches (with prefix)
 */
function exportAllComponents(url, prefix) {
  return rest.get(url).map(toError).flatMap((res) => {
    return h(_.map(res, (name) => exportComponentInstances(`${prefix}/_components/${name}/instances`, prefix))).flatten();
  });
}

/**
 * export single page
 * @param  {string} url
 * @param  {string} prefix
 * @param  {boolean} includeLayout
 * @return {Stream} of dispatches (with prefix)
 */
function exportSinglePage(url, prefix, includeLayout) {
  // get page, then fetch all children
  return rest.get(url).map(toError).flatMap((res) => {
    let children = _.reduce(res, (uris, area) => _.isArray(area) ? uris.concat(area) : uris, []);

    if (includeLayout && !_.includes(layouts, res.layout)) {
      // include the layout
      children.push(res.layout);
      layouts.push(res.layout); // keep track of it so we don't need to fetch it again
    }

    return h([h.of({ [prefixes.urlToUri(url)]: res }), _.map(children, (uri) => exportSingleItem(`${prefixes.uriToUrl(prefix, uri)}.json`))]).flatten();
  });
}

/**
 * export all bits of arbitrary data
 * e.g. lists or users
 * @param  {string} url
 * @param  {string} prefix
 * @return {Stream} of dispatches (with prefix)
 */
function exportMultipleItems(url, prefix) {
  return rest.get(url).map(toError).flatMap((res) => {
    return h(_.map(res, (uri) => exportSingleItem(prefixes.uriToUrl(prefix, uri)))).flatten();
  });
}

/**
 * export all pages
 * @param  {string} url
 * @param  {string} prefix
 * @param  {boolean} includeLayout
 * @return {Stream} of dispatches (with prefix)
 */
function exportAllPages(url, prefix, includeLayout) {
  return rest.get(url).map(toError).flatMap((res) => {
    return h(_.map(res, (uri) => exportSinglePage(prefixes.uriToUrl(prefix, uri), prefix, includeLayout))).flatten();
  });
}

/**
 * export single _uri
 * @param  {string} url
 * @return {Stream} of dispatches (with prefix)
 */
function exportSingleURI(url) {
  return rest.get(url, { type: 'text' }).map(toError).map((res) => ({ [prefixes.urlToUri(url)]: res }));
}

/**
 * export all _uris
 * @param  {string} url
 * @param  {string} prefix
 * @return {Stream} of dispatches (with prefix)
 */
function exportMultipleURIs(url, prefix) {
  return rest.get(url).map(toError).flatMap((res) => {
    return h(_.map(res, (uri) => exportSingleURI(prefixes.uriToUrl(prefix, uri)))).flatten();
  });
}

/**
 * export public url
 * @param  {string} url
 * @param  {boolean} includeLayout
 * @return {Stream} of dispatches (with prefix)
 */
function exportPublicURL(url, includeLayout) {
  return rest.findURI(url)
    .map(toError)
    .flatMap(({ uri, prefix }) => {
      const pageURL = prefixes.uriToUrl(prefix, uri);

      return exportSinglePage(pageURL, prefix, includeLayout).flatMap((dispatch) => prefixes.remove(dispatch, prefix)); // remove the prefix we found
    });
}

/**
 * generate a stream of dispatches from a single url
 * @param  {string} url
 * @param  {string} prefix
 * @param  {boolean} includeLayout
 * @return {Stream}
 */
function generateExportStream(url, prefix, includeLayout) { // eslint-disable-line
  if (utils.isComponent(url) && utils.getComponentName(url) && (utils.getComponentInstance(url) || utils.isDefaultComponent(url))) {
    // export single component (default data or specific instance)
    return exportSingleItem(`${url}.json`);
  } else if (utils.getComponentName(url) && !utils.getComponentInstance(url)) {
    // export all instances of a component
    return exportComponentInstances(url, prefix);
  } else if (_.includes(url, '_components')) {
    // export all instances of all components
    return exportAllComponents(url, prefix);
  } else if (utils.isPage(url) && utils.getPageInstance(url)) {
    // export single page, including layout if it is enabled
    return exportSinglePage(url, prefix, includeLayout);
  } else if (_.includes(url, '_pages')) {
    // export all pages
    return exportAllPages(url, prefix, includeLayout);
  } else if (url.match(/\/_?(uris)\/(.+)/)) {
    // export single uri
    return exportSingleURI(url);
  } else if (url.match(/\/_?(uris)$/)) {
    // export all uris
    return exportMultipleURIs(url, prefix);
  } else if (url.match(/\/_?(lists|users)\/(.+)/)) {
    // export single list or user
    return exportSingleItem(url);
  } else if (url.match(/\/_?(lists|users)/)) {
    // export all lists or users
    return exportMultipleItems(url, prefix);
  } else {
    // attempt to export public url
    return exportPublicURL(url, includeLayout);
  }
}

/**
 * export specific items from a single url
 * @param  {string} rawUrl
 * @param  {object} [options]
 * @param  {number} [options.concurrency]
 * @param  {boolean} [options.layout]
 * @param  {boolean} [options.yaml]
 * @return {Stream} of dispatches or single bootstrap
 */
function fromURL(rawUrl, options = {}) {
  const concurrency = options.concurrency || DEFAULT_CONCURRENCY,
    url = config.get('url', rawUrl);

  if (!url) {
    let e = new Error('URL is not defined! Please specify a url to export from');

    e.url = 'undefined url';
    // exit early if there's no url
    return h.fromError(e);
  }

  let prefix, stream;

  try {
    prefix = prefixes.getFromUrl(url);
  } catch (e) {
    prefix = null;
  }

  stream = generateExportStream(url, prefix, options.layout)
    .flatMap((dispatch) => prefixes.remove(dispatch, prefix))
    .ratelimit(concurrency, CONCURRENCY_TIME);

  if (options.yaml) {
    // return a single bootstrap
    return formatting.toBootstrap(stream);
  } else {
    // return a stream of dispatches
    return stream;
  }
}

/**
 * export items based on elastic query
 * @param  {string} rawUrl to elastic endpoint
 * @param  {object} [query]
 * @param  {object} [options]
 * @param  {number} [options.concurrency]
 * @param  {boolean} [options.layout]
 * @param  {boolean} [options.yaml]
 * @param  {number} [options.size]
 * @return {Stream} of dispatches or single bootstrap
 */
function fromQuery(rawUrl, query = {}, options = {}) {
  const concurrency = options.concurrency || DEFAULT_CONCURRENCY,
    key = config.get('key', options.key),
    prefix = config.get('url', rawUrl);

  let fullQuery, stream;

  if (!prefix) {
    let e = new Error('URL is not defined! Please specify a site prefix to export from');

    e.url = 'undefined prefix';
    // exit early if there's no url
    return h.fromError(e);
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

  stream = rest.query(`${prefix}/_search`, fullQuery, { key })
    .map(toError)
    .flatMap((res) => {
      return h(_.map(res.data, (item) => generateExportStream(prefixes.uriToUrl(prefix, item._id), prefix, options.layout))).flatten();
    })
    .flatMap((dispatch) => prefixes.remove(dispatch, prefix))
    .ratelimit(concurrency, CONCURRENCY_TIME);

  if (options.yaml) {
    // return a single bootstrap
    return formatting.toBootstrap(stream);
  } else {
    // return a stream of dispatches
    return stream;
  }
}

/**
 * clear the layouts cache
 * note: normally you don't need to care, when using claycli from the command line,
 * but if using it programmatically you should call this method to clear the layouts cache
 */
function clearLayouts() {
  layouts = [];
}

module.exports.fromURL = fromURL;
module.exports.fromQuery = fromQuery;
module.exports.clearLayouts = clearLayouts;

const deepEqual = require('deep-equal'),
  clayInput = require('../io/input-clay'),
  h = require('highland'),
  urlUtil = require('../utils/urls'),
  _ = require('lodash'),
  chunks = require('../io/agnostic-chunks'),
  clayUtils = require('clay-utils'),
  rest = require('../utils/rest');

/**
* Error handler. If err represents 404 error, pass fnc(). Otherwise, push error.
* @param {function} fnc
* @returns {function}
*/
function pass404(fnc) {
  return (err, push) => {
    if (_.get(err, 'response.status') === 404) {
      push(null, fnc());
    } else {
      push(err);
    }
  };
}

/**
 * Import data from a single component/page url.
 * @param {string} url
 * @param {string} prefix of target site
 * @param {object} [opts]
 * @param {number} [opts.concurrency]
 * @param {string} [opts.key] Authorization key for target site
 * @param {object} [opts.headers] Custom headers for PUT requests to target site
 * @param {boolean} [opts.overwrite] Overwrite mode
 * @return {Stream}
 */
function importUrl(url, prefix, {concurrency, key, headers, overwrite} = {}) {
  if (clayUtils.isList(url)) {
    return importList(url, prefix, {concurrency, key, headers, overwrite} = {});
  }
  return clayInput.importUrl(url, concurrency)
    .flatMap(chunks.replacePrefixes(prefix))
    .through(filterOverwrite(overwrite, {concurrency, headers}))
    .flatMap(item => rest.put(item, {key, concurrency, type: 'json', headers}));
}

/**
* Stream import items necessary for the import of a specified URL. Items are of the form
* {url: string, data: Object, isLayout: boolean}
* @param {string} prefix of target site
* @param {object} [opts]
* @param {number} [opts.concurrency]
* @param {string} [opts.key] Authorization key for target site
* @param {object} [opts.headers] Custom headers for PUT requests to target site
* @param {boolean} [opts.overwrite=normal] 'all' overwrites everything. 'none' overwrites nothing.
* 'notLayout' (default) overwrites everything except layouts.
* @return {Stream}
**/
function streamItemsForImport(prefix, {concurrency, headers, overwrite} = {}) {
  return (s) => s
    // get the page obj (with data) and cmpt objs (without data)
    .flatMap(url => clayInput.streamPageItems(url, concurrency))
    // drop any URLs we've already processed
    .uniqBy((a, b) => a.url === b.url)
    // fill in cmpt data
    .flatMap(item => clayInput.composeItem(item, concurrency))
    // replace all prefixes with target site's prefix
    .flatMap(chunks.replacePrefixes(prefix))
    // drop some items based on our overwrite mode
    .through(filterOverwrite(overwrite, {concurrency, headers}));
}

/**
* Based on the overwrite mode, filter out some items from a stream of
* {url: string, data: object, isLayout: boolean} objects
* @param {boolean} overwrite
* @param {Object} [opts]
* @param {number} [opts.concurrency]
* @param {Object} [opts.headers]
* @returns {Stream} With items removed
*/
function filterOverwrite(overwrite = 'notLayout', {concurrency, headers} = {}) {
  return s => {
    switch (overwrite) {
      case 'none': // remove any existing asset from the stream
        return s.flatFilter(item => filterExisting(item, {concurrency, headers}));
      case 'all': // do nothing; keep everything in the stream
        return s;
      case 'notLayout': // remove any existing layouts from the stream
        return s.flatFilter(item => {
          if (!item.isLayout) return h.of(true);
          return filterExisting(item, {concurrency, headers});
        });
      default:
        throw new Error(`overwrite mode ${overwrite} not recognized; only "none", "all", and "notLayout" are accepted`);
    }
  };
}

/**
 * Returns a filter function that removes from a stream of
 * {url: string, data: object, isLayout: boolean} objects
 * any instances that already exist.
 * @param {Object} item
 * @param {Object} [opts]
 * @param {number} [concurrency]
 * @param {Object} [headers]
 * @return {Stream}
 */
function filterExisting(item, {concurrency, headers} = {}) {
  return rest.get(item.url, {concurrency, headers, type: 'json'})
    .errors(pass404(() => h.of(true)))
    .flatMap(() => h.of(false)); // if it does exist, remove
}

/**
 * Import lists from one site to another. Merge with existing lists.
 * @param {string} sourceSite Source site prefix
 * @param {string} prefix Target site prefix
 * @param {object} [opts]
 * @param {string} [opts.key] Authorization key of target site
 * @param {number} [opts.concurrency]
 * param {Object} [opts.headers] Custom headers for PUT requests
 * @return {Stream} of rest.put results, i.e. {result: string, url: string} objects
 */
function importLists(sourceSite, prefix, {key, concurrency, headers} = {}) {
  return clayInput.getListsInSite(sourceSite)
    .flatMap(listUri => importList(`${sourceSite}/lists/${listUri}`, prefix, {key, concurrency, headers}));
}

/**
 * Merge the list at listUri into the target site.
 * @param {string} url Url of the list
 * @param {string} prefix Target site prefix
 * @param {object} [opts]
 * @param {string} [opts.key] Authorization key of target site
 * @param {number} [opts.concurrency]
 * @param {object} [opts.headers] Custom headers for PUT requests
 * @return {Stream} of rest.put results, i.e. {result: string, url: string} objects
 */
function importList(url, prefix, {key, concurrency, headers} = {}) {
  const targetUrl = prefix + '/lists/' + url.split('/lists/')[1];

  return h([url, targetUrl])
    .flatMap(url => rest.get(url, {concurrency, headers, type: 'json'}))
    .errors(pass404(() => [])) // if either list 404s, act as if empty
    .flatten()
    .uniqBy(deepEqual) // remove dups between source and target
    .collect()
    .map(newList => ({
      url: targetUrl,
      data: JSON.stringify(newList)
    }))
    .flatMap(putItems => rest.put(putItems, {key, concurrency, headers, type: 'json'}));
}

/**
 * Import all or a subset of pages from one site to another.
 * @param {string} sourceSite Prefix of site to import from
 * @param {string} prefix Prefix of site to import to
 * @param {object} [opts]
 * @param {number} [opts.limit] Number of pages to import
 * @param {number} [opts.offset] Number of pages in source site to skip
 * @param {number} [opts.concurrency]
 * @param {number} [opts.key] Authorization key of target site
 * @param {number} [opts.sourceKey] Authorization key of sour1ce site
 * @param {boolean} [opts.published] Include published pages
 * @param {boolean} [opts.overwrite] Overwrite mode
 * @return {Stream} of rest.put {result: string, url: string} objects
 */
function importPages(sourceSite, prefix, {limit, offset, concurrency, key, sourceKey, published, overwriteLayouts, headers} = {}) {
  return clayInput.getPagesInSite(sourceSite, {key: sourceKey, limit, offset})
    .map(page => published && page.published ?
      [page.uri, clayUtils.replaceVersion(page.uri, 'published')] :
      [page.uri]
    )
    .flatten()
    .map(pageUri => urlUtil.uriToUrl(sourceSite, pageUri))
    .through(streamItemsForImport(prefix, {concurrency, key, overwriteLayouts}))
    .flatMap(item => rest.put(item, {key, concurrency, headers, type: 'json'}));
}

/**
 * Import all pages from a site and, optionally, all lists.
 * @param {string} site Prefix of site to import from
 * @param {string} prefix Prefix of site to import to
 * @param {object} [opts]
 * @param {number} [opts.limit] Number of pages to import
 * @param {number} [opts.offset] Number of pages in source site to skip
 * @param {number} [opts.concurrency]
 * @param {number} [opts.key] Authorization key of target site
 * @param {number} [opts.sourceKey] Authorization key of source site (needed to query _search endpoint for pages)
 * @param {boolean} [opts.published] Include published pages
 * @param {boolean} [opts.overwrite] Overwrite mode, 'none', 'all', or 'notLayout' (default)
 * @param {boolean} [opts.lists] Include lists
 * @return {Stream} of rest.put {result: string, url: string} objects
 */
function importSite(site, prefix, {limit, offset, concurrency, key, sourceKey, overwriteLayouts, published, lists, headers} = {}) {
  let streams = [];

  streams.push(importPages(site, prefix, {
    limit, offset, concurrency, key, sourceKey, overwriteLayouts, published, headers
  }));
  if (lists) {
    streams.push(importLists(site, prefix, {concurrency, key}));
  }
  return h(streams).merge();
}

module.exports.importSite = importSite;
module.exports.importPages = importPages;
module.exports.importLists = importLists;
module.exports.importUrl = importUrl;

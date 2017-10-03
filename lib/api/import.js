const deepEqual = require('deep-equal'),
  clayInput = require('../io/input-clay'),
  h = require('highland'),
  urlUtil = require('../utils/urls'),
  _ = require('lodash'),
  chunks = require('../io/agnostic-chunks'),
  clayUtils = require('clay-utils'),
  rest = require('../utils/rest');
let lib;

/**
 * Import data from a single component/page url into the target site.
 * @param {string} url
 * @param {string} prefix of target site
 * @param {object} [opts]
 * @param {number} [opts.concurrency]
 * @param {string} [opts.key] Authorization key for target site
 * @param {object} [opts.headers] Custom headers for requests to target site
 * @param {string[]} [opts.overwrite] Overwrite mode
 * @return {Stream}
 */
function importUrl(url, prefix, {concurrency, key, headers, overwrite} = {}) {
  if (clayUtils.isList(url)) {
    overwrite = overwrite && overwrite.includes('lists');
    return importList(url, prefix, {concurrency, key, headers, overwrite });
  }
  return h([url])
    .through(streamItemsForImport(prefix, {concurrency, headers, overwrite}))
    .flatMap(putItems({key, concurrency, type: 'json', headers}));
}

/**
* Stream import items necessary for the import of a specified URL. Items are of the form
* {url: string, data: Object, isLayout: boolean, skip: boolean}
* @param {string} prefix of target site
* @param {object} [opts]
* @param {number} [opts.concurrency]
* @param {string} [opts.key] Authorization key for target site
* @param {object} [opts.headers] Custom headers for requests to target site
* @param {string[]} [opts.overwrite] Array of resource types to overwrite
* @return {Stream}
**/
function streamItemsForImport(prefix, {concurrency, headers, overwrite} = {}) {
  return (s) => s
    // get the page obj (with data) and cmpt objs (without data)
    .flatMap(url => clayInput.importUrl(url, concurrency))
    // drop any URLs we've already processed
    .uniqBy((a, b) => a.url === b.url)
    // fill in missing cmpt data
    .flatMap(item => clayInput.composeItem(item, concurrency))
    // replace all prefixes with target site's prefix
    .flatMap(chunks.replacePrefixes(prefix))
    // drop some items based on our overwrite mode
    .through(filterOverwrite(overwrite, {concurrency, headers}));
}

/**
* Based on the overwrite mode, filter out some items from a stream of
* {url: string, data: object, isLayout: boolean} objects
* @param {string[]} overwrite Can incl. "lists", "components", "pages", "layouts" and "all"
* @param {Object} [opts]
* @param {number} [opts.concurrency]
* @param {Object} [opts.headers]
* @returns {Stream} With items removed
*/
function filterOverwrite(overwrite = [], {concurrency} = {}) {
  const acceptedTypes = ['lists', 'components', 'pages', 'layouts', 'all'];

  overwrite.forEach(i => {
    if (!acceptedTypes.includes(i)) {
      throw new Error(`filterOverwrite does not recognize this type: "${i}"`);
    }
  });
  if (overwrite.includes('all') && overwrite.length > 1) {
    throw new Error('Over-specified: If "all" is passed to filterOverwrite, no other types may be passed');
  }
  if (overwrite.includes('layouts') && !overwrite.includes('components')) {
    throw new Error('Under-specified: If "layouts" is passed to filterOverwrite, "components" must also be passed; layouts are components');
  }

  return s => {
    if (overwrite.includes('all')) {
      return s;
    }
    if (!overwrite.includes('pages')) {
      s = s.flatMap(item => clayUtils.isPage(item.url) ?
        checkExisting(item, {concurrency}) :
        h.of(item));
    }
    if (!overwrite.includes('layouts')) {
      s = s.flatMap(item => item.isLayout ?
        checkExisting(item, {concurrency}) :
        h.of(item));
    }
    if (!overwrite.includes('components')) {
      s = s.flatMap(item => clayUtils.isComponent(item.url) ?
        checkExisting(item, {concurrency}) :
        h.of(item));
    }
    return s;
  };
}

/**
 * Given a Clay resource {url, data} object, set "skip" property
 * to true if the resource already exists.
 * @param {Object} item of the form {url: string, data: object}
 * @param {Object} [opts]
 * @param {number} [opts.concurrency]
 * @return {Stream}
 */
function checkExisting(item, {concurrency} = {}) {
  if (item.skip) return h.of(item); // already marked for skipping
  return rest.get(item.url, {concurrency, type: 'json'})
    .errors(rest.pass404(() => 404))
    .map(i => {
      if (i !== 404) item.skip = true;
      return item;
    });
}

/**
 * Import lists from one site to another. Merge with existing lists unless opts.overwrite is true.
 * @param {string} sourceSite Source site prefix
 * @param {string} prefix Target site prefix
 * @param {object} [opts]
 * @param {string} [opts.key] Authorization key of target site
 * @param {number} [opts.concurrency]
 * @param {boolean} [opts.overwrite] Overwrite lists instead of merging them
 * @param {Object} [opts.headers] Custom headers for PUT requests
 * @return {Stream} of rest.put results, i.e. {status: string, url: string} objects
 */
function importLists(sourceSite, prefix, {key, concurrency, headers, overwrite} = {}) {
  return clayInput.getListsInSite(sourceSite)
    .flatMap(listUri => lib.importUrl(`${sourceSite}/lists/${listUri}`, prefix, {key, concurrency, headers, overwrite}));
}

/**
 * Merge the list at listUri into the target site.
 * @param {string} url Url of the list
 * @param {string} prefix Target site prefix
 * @param {object} [opts]
 * @param {boolean} [opts.overwrite] Overwrite lists rather than merging them
 * @param {string} [opts.key] Authorization key of target site
 * @param {number} [opts.concurrency]
 * @param {object} [opts.headers] Custom headers for PUT requests
 * @return {Stream} of rest.put results, i.e. {status: string, url: string} objects
 */
function importList(url, prefix, {key, concurrency, headers, overwrite} = {}) {
  const urls = [url],
    targetUrl = prefix + '/lists/' + url.split('/lists/')[1];

  // unless overwrite is set, add the target site's list
  if (!overwrite) {
    urls.push(targetUrl);
  }

  return h(urls)
    .flatMap(url => rest.get(url, {concurrency, headers, type: 'json'}))
    .errors(rest.pass404(() => [])) // if either list 404s, act as if empty
    .flatten()
    .uniqBy(deepEqual) // remove dups between source and target
    .collect()
    .map(newList => ({
      url: targetUrl,
      data: JSON.stringify(newList)
    }))
    .flatMap(putItems({key, concurrency, headers, type: 'json'}));
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
 * @param {string[]} [opts.overwrite] Overwrite mode
 * @return {Stream} of rest.put {status: string, url: string} objects
 */
function importPages(sourceSite, prefix, {limit, offset, concurrency, key, sourceKey, published, overwrite, headers} = {}) {
  return clayInput.getPagesInSite(sourceSite, {key: sourceKey, limit, offset})
    .map(page => published && page.published ?
      [page.uri, clayUtils.replaceVersion(page.uri, 'published')] :
      [page.uri]
    )
    .flatten()
    .map(pageUri => urlUtil.uriToUrl(sourceSite, pageUri))
    .through(streamItemsForImport(prefix, {concurrency, key, overwrite}))
    .flatMap(putItems({key, concurrency, headers}));
}

/**
* PUT items that are not marked to be skipped.
* @param {Object} [opts]
* @param {string} [opts.key]
* @param {number} [opts.concurrency]
* @param {Object} [opts.headers]
* @return {function}
**/
function putItems({key, concurrency, headers}) {
  return (item) => item.skip ?
    h.of({url: item.url, status: 'skipped'}) :
    rest.put(item, {key, concurrency, headers, type: 'json'});
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
 * @param {string[]} [opts.overwrite] Overwrite mode
 * @return {Stream} of rest.put {status: string, url: string} objects
 */
function importSite(site, prefix, {limit, offset, concurrency, key, sourceKey, overwrite, published, headers} = {}) {
  return h([
    lib.importPages(site, prefix, {
      limit, offset, concurrency, key, sourceKey, overwrite, published, headers
    }),
    lib.importLists(site, prefix, {
      concurrency, key, overwrite: overwrite && overwrite.includes('lists')
    })
  ]).merge();
}

lib = {importSite, importPages, importLists, importUrl};
module.exports = lib;

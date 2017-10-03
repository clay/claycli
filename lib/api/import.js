const clayInput = require('../io/input-clay'),
  h = require('highland'),
  deepEqual = require('deep-equal'),
  urlUtil = require('../utils/urls'),
  chunks = require('../io/agnostic-chunks'),
  clayUtils = require('clay-utils'),
  rest = require('../utils/rest');
let lib;

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
    // stream Clay assets ({url, data, isLayout}) for each url
    .through(clayInput.streamAssets(concurrency))
    // replace prefixes throughout assets
    .flatMap(chunks.replacePrefixes(prefix))
    // mark assets for skipping according to "overwrite" setting
    .through(filterOverwrite(overwrite, {concurrency, headers}));
}

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
  return h([url])
    .through(streamItemsForImport(prefix, {concurrency, headers, overwrite}))
    .flatMap(putItems({key, concurrency, type: 'json', headers}));
}

/**
* Validate values for overwrite
* @param {string[]} overwrite
*/
function validateOverwriteOption(overwrite) {
  const acceptedTypes = ['lists', 'components', 'pages', 'layouts', 'all'],
    unrecognized = overwrite.filter(i => !acceptedTypes.includes(i)).join(', ');

  if (unrecognized) {
    throw new Error(`filterOverwrite does not recognize these types: ${unrecognized}`);
  }
  if (overwrite.includes('all') && overwrite.length > 1) {
    throw new Error('Over-specified: If "all" is passed to filterOverwrite, no other types may be passed');
  }
  if (overwrite.includes('layouts') && !overwrite.includes('components')) {
    throw new Error('Under-specified: If "layouts" is passed to filterOverwrite, "components" must also be passed; layouts are components');
  }
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
  validateOverwriteOption(overwrite);
  return s => {
    if (overwrite.includes('all')) {
      return s; // i.e. keep everything
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
    if (!overwrite.includes('lists')) {
      s = s.flatMap(item => clayUtils.isList(item.url) ?
        mergeExisting(item, {concurrency})
        : h.of(item)
      );
    }
    return s;
  };
}

/**
* Given a Clay asset {url, data} object, if the asset already exists,
* merge its current data into the asset object.
* @param {Object} item of the form {url: string, data: object}
* @param {Object} [opts]
* @param {number} [opts.concurrency]
* @return {Stream}
**/
function mergeExisting(item, {concurrency} = {}) {
  if (item.skip) return h.of(item);

  return rest.get(item.url, {concurrency, type: 'json'})
    .errors(rest.pass404(() => [])) // if either list 404s, act as if empty
    .append(item.data)
    .flatten()
    .uniqBy(deepEqual) // remove dups between source and target
    .collect()
    .map(i => {
      item.data = i;
      return item;
    });
}

/**
 * Given a Clay asset {url, data} object, set "skip" property
 * to true if the asset already exists.
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
    .map(listUri => urlUtil.uriToUrl(sourceSite, listUri))
    .flatMap(listUrl => lib.importUrl(`${listUrl}`, prefix, {key, concurrency, headers, overwrite}));
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
    lib.importLists(site, prefix, {concurrency, key, overwrite})
  ]).merge();
}

lib = {
  importSite,
  importPages,
  importLists,
  importUrl
};
module.exports = lib;

const h = require('highland'),
  importApi = require('./index');

/**
 * Import all pages, including their components, and (optionally) all lists from one Clay site to another.
 * @param {string} sourceSite Prefix of source site
 * @param {string} targetSite Prefix of target site
 * @param {object} [opts]
 * @param {number} [opts.limit] Number of pages to import, starting with most recently created
 * @param {number} [opts.offset] Number of pages in source site to skip, starting with most recently created
 * @param {number} [opts.concurrency]
 * @param {number} [opts.key] Authorization key of target site
 * @param {number} [opts.sourceKey] Authorization key of source site (to query its _search endpoint for pages)
 * @param {boolean} [opts.overwriteLayouts] Overwrite layouts and their children
 * @param {boolean} [opts.published] Include published pages
 * @param {headers} [opts.headers] Custom headers for PUT requests
 * @param {Array[]} [opts.include] Cherrypick asset types for import. Options: 'all' (default), 'pages', 'lists', 'uris', and 'users'
 * @return {Stream} of rest.put {status: string, url: string} objects
 */
function importSite(sourceSite, targetSite, {limit, offset, concurrency, key, sourceKey, overwriteLayouts, published, headers} = {}) {
  return h([
    importApi.importPages(sourceSite, targetSite, {
      limit, offset, concurrency, key, sourceKey, overwriteLayouts, published, headers
    }),
    importApi.importLists(sourceSite, targetSite, {concurrency, key}),
    importApi.importUris(sourceSite, targetSite, {concurrency, key}),
    importApi.importUsers(sourceSite, targetSite, {concurrency, key})
  ]).mergeWithLimit(concurrency);
}

module.exports = importSite;

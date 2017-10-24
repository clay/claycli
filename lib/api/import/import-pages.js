const clayInput = require('../../io/input-clay'),
  urlUtil = require('../../utils/urls'),
  clayUtils = require('clay-utils'),
  importApi = require('./index');

/**
 * Import all or a subset of pages from one site to another.
 * @param {string} sourceSite Prefix of source site
 * @param {string} targetSite Prefix of target site
 * @param {object} [opts]
 * @param {number} [opts.limit] Number of pages to import
 * @param {number} [opts.offset] Number of pages in source site to skip
 * @param {number} [opts.concurrency]
 * @param {number} [opts.key] Authorization key of target site
 * @param {number} [opts.sourceKey] Authorization key of sour1ce site
 * @param {boolean} [opts.published] Include published pages
 * @param {boolean} [opts.overwriteLayouts] Overwrite layouts and their children
 * @return {Stream} of rest.put {status: string, url: string} objects
 */
function importPages(sourceSite, targetSite, {limit, offset, concurrency, key, sourceKey, published, overwriteLayouts, headers} = {}) {
  return clayInput.streamPageUris(sourceSite, {key: sourceKey, limit, offset})
    // unless published is set, filter out all published URIs
    .filter(pageUri => published || clayUtils.getPageVersion(pageUri) !== 'published')
    .map(pageUri => urlUtil.uriToUrl(sourceSite, pageUri))
    .through(urlStream => importApi.importUrl(urlStream, targetSite, {concurrency, key, overwriteLayouts, headers}));
}

module.exports = importPages;

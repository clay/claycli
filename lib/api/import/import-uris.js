const clayInput = require('../../io/input-clay'),
  urlUtil = require('../../utils/urls'),
  importApi = require('./index');

/**
 * Import URIs (i.e. from /uris endpoint; these map canonical URLs to page objects)
 * from one site to another. Warning: The destination site must have matching route
 * handlers for the URLs to actually work.
 * @param {string} sourceSite Prefix of source site
 * @param {string} targetSite Prefix of target site
 * @param {object} [opts]
 * @param {string} [opts.key] Authorization key of target site
 * @param {number} [opts.concurrency]
 * @param {Object} [opts.headers] Custom headers for PUT requests
 * @return {Stream} of rest.put results, i.e. {status: string, url: string} objects
 */
function importUris(sourceSite, targetSite, {key, concurrency, headers} = {}) {
  return clayInput.streamUris(sourceSite)
    .map(uriUri => urlUtil.uriToUrl(sourceSite, uriUri))
    .flatMap(uriUrl => importApi.importUrl(uriUrl, targetSite, {key, concurrency, headers}));
}

module.exports = importUris;

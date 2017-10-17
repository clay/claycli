const clayInput = require('../../io/input-clay'),
  urlUtil = require('../../utils/urls'),
  importApi = require('./index');

/**
 * Import users from one site to another.
 * @param {string} sourceSite Prefix of source site
 * @param {string} targetSite Prefix of target site
 * @param {object} [opts]
 * @param {string} [opts.key] Authorization key of target site
 * @param {number} [opts.concurrency]
 * @param {Object} [opts.headers] Custom headers for PUT requests
 * @return {Stream} of rest.put results, i.e. {status: string, url: string} objects
 */
function importLists(sourceSite, targetSite, {key, concurrency, headers} = {}) {
  return clayInput.streamListUris(sourceSite)
    .map(listUri => urlUtil.uriToUrl(sourceSite, listUri))
    .flatMap(listUrl => importApi.importUrl(listUrl, targetSite, {key, concurrency, headers}));
}

module.exports = importLists;

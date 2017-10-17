const clayInput = require('../../io/input-clay'),
  urlUtil = require('../../utils/urls'),
  importApi = require('./index');

/**
 * Import lists from one site to another.
 * @param {string} sourceSite Prefix of source site
 * @param {string} targetSite Prefix of target site
 * @param {object} [opts]
 * @param {string} [opts.key] Authorization key of target site
 * @param {number} [opts.concurrency]
 * @param {Object} [opts.headers] Custom headers for PUT requests
 * @return {Stream} of rest.put results, i.e. {status: string, url: string} objects
 */
function importUsers(sourceSite, targetSite, {key, concurrency, headers} = {}) {
  return clayInput.streamUserUris(sourceSite)
    .map(userUri => urlUtil.uriToUrl(sourceSite, userUri))
    .flatMap(userUrl => importApi.importUrl(`${userUrl}`, targetSite, {key, concurrency, headers}));
}

module.exports = importUsers;

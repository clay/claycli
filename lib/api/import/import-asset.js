const rest = require('../../utils/rest'),
  _ = require('lodash'),
  h = require('highland');

/**
* Commit the data in a {data, url} Clay assets via a PUT request,
* unless clayAsset.skip is true.
* @param {Object} [clayAsset]
* @param {string} [options.key]
* @param {number} [options.concurrency]
* @param {Object} [options.headers]
* @return {function}
*/
function importAssets(clayAsset, {key, concurrency, headers} = {}) {
  return clayAsset.skip ?
    h.of({url: clayAsset.url, status: 'skipped'}) :
    rest.put(clayAsset, {
      key,
      concurrency,
      headers,
      type: _.includes(clayAsset.url, '/uris') ? 'text' : 'json'
    });
}

module.exports = importAssets;

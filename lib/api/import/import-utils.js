const rest = require('../../utils/rest'),
  _ = require('lodash'),
  h = require('highland');

/**
* Return a function that PUTs {data, url} Clay assets, except
* for any where "skip" is set to true.
* @param {Object} [options]
* @param {string} [options.key]
* @param {number} [options.concurrency]
* @param {Object} [options.headers]
* @return {function}
*/
function putAssets({key, concurrency, headers}) {
  return (clayAsset) => clayAsset.skip ?
    h.of({url: clayAsset.url, status: 'skipped'}) :
    rest.put(clayAsset, {
      key,
      concurrency,
      headers,
      type: _.includes(clayAsset.url, '/uris') ? 'text' : 'json'
    });
}

module.exports.putAssets = putAssets;

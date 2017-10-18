const _ = require('lodash'),
  urlUtil = require('../../utils/urls'),
  chunksUtil = require('../../io/agnostic-chunks'),
  importApi = require('./index'),
  {createStream} = require('../../utils/stream-util');

/**
 * Convert chunks in the form {[baseUri]: data} into {url, data}
 * asset objects.
 * @param  {string} prefix
 * @return {function}
 */
function mapChunksToAssets(prefix) {
  const uriPrefix = urlUtil.urlToUri(prefix);

  return (chunk) => {
    const withPrefix = chunksUtil.fromChunk(uriPrefix, chunk),
      uri = Object.keys(withPrefix)[0],
      val = withPrefix[uri],
      data = _.isString(val) ? val : JSON.stringify(val), // val might be data or uri string
      url = urlUtil.uriToUrl(prefix, uri);

    return {url, data};
  };
}

/**
 * Import data from a stream or array of chunks, or single chunk.
 * A chunk is a {[baseUri]: data} object.
 * @param  {Stream|Object[]|Object} chunks
 * @param {string} targetSite
 * @param {string} [opts.key] Key of target site
 * @param {Object} [opts.headers] Custom headers for PUT requests
 * @param {number} [opts.concurrency]
 * @return {Stream}
 */
function importChunk(chunks, targetSite, {key, headers, concurrency} = {}) {
  return createStream(chunks)
    .map(chunksUtil.validate)
    .map(mapChunksToAssets(targetSite))
    .flatMap(asset => importApi.importAsset(asset, {key, headers, concurrency}));
}

module.exports = importChunk;

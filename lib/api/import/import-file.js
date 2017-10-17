const files = require('../../io/input-files'),
  importApi = require('./index');

/**
 * Import data from YAML/JSON files.
 * @param  {string} filepath
 * @param  {string} targetSite Prefix of target site
 * @param  {object} [opts]
 * @param {string} [opts.key] Key of target site
 * @param {Object} [opts.headers] Custom headers for PUT requests
 * @param {number} [opts.concurrency]
 * @return {Stream} of rest.put {status: string, url: string} objects
 */
function importFile(filepath, targetSite, {key, headers, concurrency} = {}) {
  return files.get(filepath)
    .filter(files.omitSchemas)
    .through(chunkStream => importApi.importChunk(chunkStream, targetSite, {key, headers, concurrency}));
}

module.exports = importFile;

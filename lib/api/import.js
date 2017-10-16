const clayInput = require('../io/input-clay'),
  h = require('highland'),
  _ = require('lodash'),
  deepEqual = require('deep-equal'),
  urlUtil = require('../utils/urls'),
  chunksUtil = require('../io/agnostic-chunks'),
  clayUtils = require('clay-utils'),
  rest = require('../utils/rest'),
  files = require('../io/input-files'),
  {createStream} = require('../utils/stream-util'),
  deepReduce = require('../utils/deep-reduce'),
  normalizeCmpt = require('../utils/normalize-components'),
  lib = module.exports; // for stubbing internal functions

/**
* Stream Clay assets necessary for the import of URLs to a specified site.
* Assets are of the form {url: string, data: Object, isLayout: boolean, skip: boolean},
* where "url" is the destination URL, "data" is the destination data, "isLayout"
* indicates that the cmpt appeared as the layout of a page, and "skip" indicates
* the cmpt should not actually be PUT to the destination site.
* @param {Stream|string[]|string} sourceUrls Stream or array of URLs or single URL
* @param {string} targetSite Prefix of target site
* @param {object} [opts]
* @param {number} [opts.concurrency]
* @param {string} [opts.key] Authorization key for target site
* @param {object} [opts.headers] Custom headers for requests to target site
* @param {boolean} [opts.overwriteLayouts] Overwrite layouts and their children
* @return {Stream} of assets
**/
function streamAssetsForImport(sourceUrls, targetSite, {concurrency, overwriteLayouts} = {}) {
  // stream Clay assets ({url, data, isLayout}) for each url
  return clayInput.streamAssets(sourceUrls, concurrency)
    // replace prefixes in assets
    .flatMap(chunksUtil.replacePrefixes(targetSite))
    // check for layout children
    .through(stream => overwriteLayouts ?
      stream :
      skipLayoutCmpts(stream, {concurrency})
    )
    // merge lists; do not overwrite them
    .flatMap(asset => clayUtils.isList(asset.url) ?
      mergeExisting(asset, {concurrency}) :
      h.of(asset)
    );
}

/**
* Given a stream of {url, data, isLayout} assets, atomize layout assets and
* add a "skip" property to any layout or layout child that already exists.
* @param {Stream} stream a stream of assets
* @param {Object} [opts]
* @param {number} [opts.concurrency]
* @returns {Stream} of assets
**/
function skipLayoutCmpts(stream, {concurrency}) {
  return stream
    .flatMap(asset => asset.isLayout ?
      atomizeAsset(asset).doto(asset => asset.overwrite = false) :
      h.of(asset)
    )
    .uniqBy((a, b) => a.url === b.url)
    .flatMap(asset => asset.overwrite === false ?
      checkExisting(asset, {concurrency}) :
      h.of(asset)
    );
}

/**
* Split the specified asset with composed data into an array of "decomposed"
* assets without child data.
* @param {Object} asset
* @return {Stream} of atomized assets
**/
function atomizeAsset(asset) {
  const {prefix} = urlUtil.getUrlPrefix(asset.url),
    assets = [{
      url: asset.url,
      data: normalizeCmpt(asset.data)
    }];

  deepReduce(assets, asset.data, (ref, val) => assets.push({
    url: urlUtil.uriToUrl(prefix, ref),
    data: normalizeCmpt(val)
  }));
  return h(assets);
}

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

/**
* Given a Clay asset {url, data} object, if the asset already exists,
* merge its current data into the asset object.
* @param {Object} asset of the form {url: string, data: object}
* @param {Object} [opts]
* @param {number} [opts.concurrency]
* @return {Stream} of assets with data merged with their existing counterparts
**/
function mergeExisting(asset, {concurrency} = {}) {
  return rest.get(asset.url, {concurrency, type: 'json'})
    .errors(rest.pass404(() => [])) // if list 404s, act as if empty
    .map(targetList => asset.data.concat(targetList))
    .sequence() // (flatten only one level, in case there are lists of lists)
    .uniqBy(deepEqual) // remove dups between source and target
    .collect()
    .map(i => {
      asset.data = i;
      return asset;
    });
}

/**
 * Given a Clay asset {url, data} object, set "skip" property
 * to true if the asset already exists.
 * @param {Object} asset of the form {url: string, data: object}
 * @param {Object} [opts]
 * @param {number} [opts.concurrency]
 * @return {Stream}
 */
function checkExisting(asset, {concurrency} = {}) {
  if (asset.skip) return h.of(asset); // already marked for skipping
  return rest.get(asset.url, {concurrency, type: 'json'})
    .errors(rest.pass404(() => 404))
    .map(i => {
      if (i !== 404) asset.skip = true;
      return asset;
    });
}

/**
 * Import data from a single Clay asset url into the target site.
 * @param {Stream|string[]|string} sourceUrl Stream or array of URLs, or single URL
 * @param {string} targetSite Prefix of target site
 * @param {object} [opts]
 * @param {number} [opts.concurrency]
 * @param {string} [opts.key] Authorization key for target site
 * @param {object} [opts.headers] Custom headers for requests to target site
 * @param {boolean} [opts.overwriteLayouts] Overwrite layouts and their children
 * @return {Stream}
 */
function importUrl(sourceUrl, targetSite, {concurrency, key, headers, overwriteLayouts} = {}) {
  return streamAssetsForImport(sourceUrl, targetSite, {concurrency, headers, overwriteLayouts})
    .flatMap(putAssets({key, concurrency, type: 'json', headers}));
}

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
    .through(urlStream => lib.importUrl(urlStream, targetSite, {concurrency, key, overwriteLayouts, headers}));
}

/**
 * Import lists from one site to another. Merge with existing lists unless opts.overwrite is true.
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
    .flatMap(listUrl => lib.importUrl(`${listUrl}`, targetSite, {key, concurrency, headers}));
}

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
    .flatMap(userUrl => lib.importUrl(`${userUrl}`, targetSite, {key, concurrency, headers}));
}

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
    .flatMap(listUrl => lib.importUrl(listUrl, targetSite, {key, concurrency, headers}));
}

/**
 * Import URIs (which map URLs to pages) from one site to another. Warning: The destination
 * site must have matching route handlers for the URLs to actually work.
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
    .flatMap(uriUrl => lib.importUrl(uriUrl, targetSite, {key, concurrency, headers}));
}

/**
 * Import all pages, including their components, and (optionally) all lists from one Clay site to another.
 * @param {string} sourceSite Prefix of source site
 * @param {string} targetSite Prefix of target site
 * @param {object} [opts]
 * @param {number} [opts.limit] Number of pages to import
 * @param {number} [opts.offset] Number of pages in source site to skip
 * @param {number} [opts.concurrency]
 * @param {number} [opts.key] Authorization key of target site
 * @param {number} [opts.sourceKey] Authorization key of source site (needed to query _search endpoint for pages)
 * @param {boolean} [opts.overwriteLayouts] Overwrite layouts and their children
 * @param {boolean} [opts.published] Include published pages
 * @param {headers} [opts.headers] Custom headers for PUT requests
 * @return {Stream} of rest.put {status: string, url: string} objects
 */
function importSite(sourceSite, targetSite, {limit, offset, concurrency, key, sourceKey, overwriteLayouts, published, headers} = {}) {
  return h([
    lib.importPages(sourceSite, targetSite, {
      limit, offset, concurrency, key, sourceKey, overwriteLayouts, published, headers
    }),
    lib.importLists(sourceSite, targetSite, {concurrency, key}),
    lib.importUris(sourceSite, targetSite, {concurrency, key}),
    lib.importUsers(sourceSite, targetSite, {concurrency, key})
  ]).mergeWithLimit(concurrency);
}

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
    .through(chunkStream => importChunk(chunkStream, targetSite, {key, headers, concurrency}));
}

/**
 * Convert chunks in the form {[baseUri]: data} into {url, data}
 * asset objects
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
    .flatMap(putAssets({key, headers, concurrency}));
}

module.exports.importUrl = importUrl;
module.exports.importChunk = importChunk;
module.exports.importPages = importPages;
module.exports.importLists = importLists;
module.exports.importUris = importUris;
module.exports.importUsers = importUsers;
module.exports.importSite = importSite;
module.exports.importFile = importFile;

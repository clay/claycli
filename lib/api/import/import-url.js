const clayInput = require('../../io/input-clay'),
  h = require('highland'),
  deepEqual = require('deep-equal'),
  urlUtil = require('../../utils/urls'),
  chunksUtil = require('../../io/agnostic-chunks'),
  clayUtils = require('clay-utils'),
  rest = require('../../utils/rest'),
  deepReduce = require('../../utils/deep-reduce'),
  normalizeCmpt = require('../../utils/normalize-components'),
  {putAssets} = require('./import-utils');

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
* Stream Clay assets necessary for the import of URLs to a specified site.
* Assets are of the form {url: string, data: Object, isLayout: boolean, skip: boolean},
* where "url" is the destination URL, "data" is the final data, "isLayout"
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

module.exports = importUrl;

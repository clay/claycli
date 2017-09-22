const deepEqual = require('deep-equal'),
  clayInput = require('../io/input-clay'),
  h = require('highland'),
  urlUtil = require('../utils/urls'),
  _ = require('lodash'),
  chunks = require('../io/agnostic-chunks'),
  rest = require('../utils/rest');

/**
 * Convert errors into result objects and pass them along.
 * @param {Error} err
 * @param {Function} push
 */
function passErrors(err, push) {
  push(null, {
    status: 'error',
    error: err
  });
}

/**
 * import data from a single component/page url
 * @param {string} url
 * @param {string} prefix of target site
 * @param {object} [opts]
 * @param {number} [opts.concurrency]
 * @param {string} [opts.key] Authorization key for target site
 * @param {object} [opts.headers] Custom headers for PUT requests to target site
 * @param {boolean} [opts.overwriteLayouts] Overwrite layouts in target site
 * @return {Stream}
 */
function importUrl(url, prefix, {concurrency, key, headers, overwriteLayouts}) {
  const stream = clayInput.importUrl(url, concurrency)
    .flatMap(chunks.replacePrefixes(prefix));

  if (!overwriteLayouts) {
    stream.filter(filterExistingLayouts({concurrency, key, headers}));
  }

  return stream
    .flatMap(item => rest.put(item, {key, concurrency, type: 'json', headers}))
    .errors(passErrors);
}

/**
 * Returns a filter function that removes from a stream of
 * {url: string, data: object, isLayout: boolean} objects
 * any layout instances that already exist, unless
 * arg.overwriteLayouts is set.
 * @param {Object} argv
 * @return {function}
 */
function filterExistingLayouts({concurrency, headers, key}) {
  return (item) => {
    if (!item.isLayout) {
      return h.of(true);
    }
    return rest.get(item.url, {concurrency, headers, key, type: 'json'})
      .errors((err, push) => {
        // if a 404, list doesn't exist
        if (_.get(err, 'response.status') === 404) {
          return h.of(true);
        }
        push(err);
      })
      .flatMap(() => h.of(false));
  };
}

/**
 * Import lists from a specified site. Merge with existing lists.
 * @param {string} sourceSite
 * @param {string} prefix
 * @param {object} argv
 * @return {Stream}  of rest.put {result: string, url: string} objects
 */
function importLists(sourceSite, prefix, argv) {
  return clayInput.getListsInSite(sourceSite)
    .flatMap(listUri => importList(listUri, sourceSite, prefix, argv));
}

/**
 * Merge the list at listUri into the target site.
 * @param {string} listUri
 * @param {string} sourceSite
 * @param {string} prefix
 * @param {Object} argv
 * @return {Stream} of rest.put {result: string, url: string} objects
 */
function importList(listUri, sourceSite, prefix, argv) {
  const sourceUrl = urlUtil.uriToUrl(sourceSite, listUri),
    targetUrl = prefix + '/lists/' + listUri.split('/lists/')[1];

  return h([sourceUrl, targetUrl])
    .flatMap(rest.get)
    .errors((err, push) => {
      if (_.get(err, 'response.status') === 404) return [];
      push(err); // if not 404, propagate error
    })
    .flatten()
    .uniqBy(deepEqual)
    .collect()
    .map(newList => ({
      url: targetUrl,
      data: JSON.stringify(newList)
    }))
    .flatMap(putItems => rest.put(putItems, {
      key: argv.key,
      concurrency: argv.concurrency,
      type: 'json'
    }))
    .errors(passErrors);
}

/**
 * Import all pages from a site.
 * @param {string} sourceSite Prefix of site to import from
 * @param {string} prefix Prefix of site to import to
 * @param {object} [opts]
 * @param {number} [opts.limit] Number of pages to import
 * @param {number} [opts.offset] Number of pages in source site to skip
 * @param {number} [opts.concurrency]
 * @param {number} [opts.key] Authorization key of target site
 * @param {number} [opts.sourceKey] Authorization key of source site
 * @param {boolean} [opts.published] Include published pages
 * @param {boolean} [opts.overwriteLayouts] Overwrite layouts in target site
 * @return {Stream} of rest.put {result: string, url: string} objects
 */
function importPages(sourceSite, prefix, {limit, offset, concurrency, key, sourceKey, published, overwriteLayouts}) {

  if (!sourceKey) {
    console.error('you must provide a sourceKey');
    process.exit(1);
  }

  return clayInput.getPagesInSite(sourceSite, {key: sourceKey, limit, offset})
    .map(page => published && page.published ?
      [page.uri, page.uri + '@published'] :
      [page.uri]
    )
    .flatten()
    .map(pageUri => urlUtil.uriToUrl(sourceSite, pageUri))
    .flatMap(pageUrl => importUrl(pageUrl, prefix, {concurrency, key, overwriteLayouts}))
}

/**
 * Import all pages from a site and, optionally, all lists.
 * @param {string} site Prefix of site to import from
 * @param {string} prefix Prefix of site to import to
 * @param {object} [opts]
 * @param {number} [opts.limit] Number of pages to import
 * @param {number} [opts.offset] Number of pages in source site to skip
 * @param {number} [opts.concurrency]
 * @param {number} [opts.key] Authorization key of target site
 * @param {number} [opts.sourceKey] Authorization key of source site
 * @param {boolean} [opts.published] Include published pages
 * @param {boolean} [opts.overwriteLayouts] Overwrite layouts in target site
 * @param {boolean} [opts.lists] Include lists
 * @return {Stream} of rest.put {result: string, url: string} objects
 */
function importSite(site, prefix, {limit, offset, concurrency, key, sourceKey, overwriteLayouts, published, lists} = {}) {
  let streams = [];

  streams.push(importPages(site, prefix, {
    limit, offset, concurrency, key, sourceKey, overwriteLayouts, published
  }));
  if (lists) {
    streams.push(importLists(site, prefix, {concurrency, key}));
  }
  return h(streams).merge();
}

module.exports.importSite = importSite;
module.exports.importPages = importPages;
module.exports.importLists = importLists;
module.exports.importList = importList;
module.exports.importUrl = importUrl;

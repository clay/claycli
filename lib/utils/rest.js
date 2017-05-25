const bluebird = require('bluebird'),
  h = require('highland'),
  _ = require('lodash'),
  fetch = require('./fetch'),
  logger = require('./logger'),
  contentHeader = 'Content-Type',
  contentJSON = 'application/json; charset=UTF-8',
  DEFAULT_CONCURRENCY = 5;

fetch.Promise = bluebird;

function catchError(error) {
  return { statusText: error.message };
}

function checkStatus(url) {
  return (res) => {
    if (res.status && res.status >= 200 && res.status < 400) {
      return res;
    } else if (res.url && res.url !== url) {
      // login redirect!
      let error = new Error('Not Authorized');

      error.response = res;
      throw error;
    } else {
      // some other error
      let error = new Error(res.statusText);

      error.response = res;
      throw error;
    }
  };
}

function send(url, options) {
  return fetch.send(url, options)
    .catch(catchError)
    .then(checkStatus(url));
}

/**
 * create stream from items
 * items are either a stream, an array of things, or an individual things
 * @param  {Stream|array|*} items
 * @return {Stream}
 */
function createStream(items) {
  if (h.isStream(items)) {
    return items;
  } else if (_.isArray(items)) {
    return h(items);
  } else {
    return h([items]);
  }
}

/**
 * get an array of urls
 * creates a stream with data from each url, or emits an error
 * @param  {Stream|array|string} urls array of urls or single url
 * @param {number} [concurrency]
 * @return {Stream}
 */
function get(urls, concurrency) {
  concurrency = concurrency || DEFAULT_CONCURRENCY;
  return createStream(urls).map((url) => {
    logger.debug(`GET ${url}`);
    return h(send(url, { method: 'GET' })
      .then((res) => res.json())
      .catch((e) => {
        e.url = url; // capture the url every time we error
        throw e;
      }));
  }).mergeWithLimit(concurrency);
}

/**
 * check to see if an array of urls exist by doing HEAD requests against them
 * creates a stream with urls that don't exist
 * @param  {Stream|array|string} urls array of urls or single url
 * @param  {number} [concurrency]
 * @return {Stream}
 */
function check(urls, concurrency) {
  concurrency = concurrency || DEFAULT_CONCURRENCY;
  return createStream(urls).map((url) => {
    logger.debug(`HEAD ${url}`);
    return h(send(url, { method: 'HEAD' }).then(() => false).catch(() => url));
  }).mergeWithLimit(concurrency).compact();
}

/**
 * put an array of items
 * @param  {Stream|array|object} items with { url: data }
 * @param  {number} [concurrency]
 * @return {Stream}
 */
function put(items, concurrency) {
  concurrency = concurrency || DEFAULT_CONCURRENCY;

  return createStream(items).map((item) => {
    // each item should be { url: data }, e.g. if they're parsed by chunks.fromChunk()
    const url = Object.keys(item)[0],
      data = item[url];

    logger.debug(`PUT ${url}`);
    return h(send(url, {
      method: 'PUT',
      body: JSON.stringify(data),
      headers: {
        [contentHeader]: contentJSON
      }
    }).then((res) => res.json()));
  }).mergeWithLimit(concurrency);
}

module.exports.get = get;
module.exports.check = check;
module.exports.put = put;

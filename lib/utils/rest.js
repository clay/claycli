const bluebird = require('bluebird'),
  h = require('highland'),
  _ = require('lodash'),
  fetch = require('./fetch'),
  logger = require('./logger'),
  contentHeader = 'Content-Type',
  contentJSON = 'application/json; charset=UTF-8',
  contentText = 'text/plain; charset=UTF-8',
  DEFAULT_CONCURRENCY = 1; // note: argv.concurrency has a default of 10, so you should never be seeing requests go out at this value

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
 * @param {string} type 'json' or 'text'
 * @param {object} [headers]
 * @return {Stream}
 */
function get(urls, concurrency, type, headers) {
  type = type || 'json';
  concurrency = concurrency || DEFAULT_CONCURRENCY;
  return createStream(urls).map((url) => {
    logger.debug(`GET ${url}`);
    return h(send(url, {
        method: 'GET',
        headers: headers
      })
      .then((res) => res[type]())
      .catch((e) => {
        e.url = url; // capture the url every time we error
        throw e;
      }));
  }).mergeWithLimit(concurrency);
}

/**
 * put an array of items
 * @param  {Stream|array|object} items with { url: data }
 * @param {string} key
 * @param  {number} [concurrency]
 * @param {string} [type]
 * @param {object} [headers]
 * @return {Stream}
 */
function put(items, key, concurrency, type, headers) {
  concurrency = concurrency || DEFAULT_CONCURRENCY;
  type = type || 'json';
  return createStream(items).map((item) => {
    // each item should be { url, data: stringified }, e.g. if they're parsed by chunks.replacePrefixes
    const url = item.url,
      data = item.data;

    logger.debug(`PUT ${url}`);
    return h(send(url, {
      method: 'PUT',
      body: data,
      headers: Object.assign(
        {
          [contentHeader]: type === 'json' ? contentJSON : contentText,
          Authorization: `Token ${key}`
        },
        headers
      )
      // we don't care about the data returned from the put, but we do care it it worked or not
    }).then(() => ({ result: 'success', url })).catch((e) => ({ result: 'error', url, message: e.message })));
  }).mergeWithLimit(concurrency);
}

module.exports.get = get;
module.exports.put = put;

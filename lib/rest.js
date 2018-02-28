'use strict';
const fetch = require('isomorphic-fetch'),
  h = require('highland'),
  _ = require('lodash'),
  nodeUrl = require('url'),
  https = require('https'),
  agent = new https.Agent({ rejectUnauthorized: false }), // allow self-signed certs
  logger = require('./debug-logger'),
  CONTENT_TYPES = {
    json: 'application/json; charset=UTF-8',
    text: 'text/plain; charset=UTF-8'
  };

let log = logger(__filename);

/**
 * get protocol to determine if we need https agent
 * @param {string} url
 * @returns {string}
 */
function isSSL(url) {
  return nodeUrl.parse(url).protocol === 'https:';
}

/**
 * catch errors in api calls
 * @param  {Error} error
 * @return {object}
 */
function catchError(error) {
  return { statusText: error.message };
}

/**
 * check status of api calls
 * note: this happens AFTER catchError, so those errors are dealt with here
 * @param  {object} res
 * @return {object}
 */
function checkStatus(res) {
  if (res.status && res.status >= 200 && res.status < 400) {
    return res;
  } else {
    // some other error
    let error = new Error(res.statusText);

    error.response = res;
    throw error;
  }
}

/**
 * perform the http(s) call
 * @param  {string} url
 * @param  {object} options
 * @return {Promise}
 */
function send(url, options) {
  return fetch(url, options)
    .catch(catchError)
    .then(checkStatus);
}

/**
 * GET api call
 * @param  {Stream} stream  of urls
 * @param  {object} options
 * @param {object} [options.headers]
 * @param {string} [options.type] defaults to json, can be json or text
 * @return {Stream}
 */
function get(stream, options = {}) {
  options.type = options.type || 'json';
  return stream.flatMap((url) => {
    log.debug(`GET ${url}`);
    return h(send(url, {
      method: 'GET',
      headers: options.headers,
      agent: isSSL(url) ? agent : null
    }).then((res) => res[options.type]()));
  });
}

/**
 * PUT api call
 * @param  {Stream} stream  of objects with { url, data }
 * @param  {object} options
 * @param {string} options.key api key
 * @param {object} [options.headers]
 * @param {string} [options.type] defaults to json, can be json or text
 * @return {Stream}
 */
function put(stream, options = {}) {
  if (!options.key) {
    throw new Error('Please specify API key to do PUT requests against Clay!');
  }

  options.type = options.type || 'json';
  return stream.flatMap(({ url, data }) => {
    const headers = _.assign({
      'Content-Type': CONTENT_TYPES[options.type],
      Authorization: `Token ${options.key}`
    }, options.headers);

    log.debug(`PUT ${url}`);
    return h(send(url, {
      method: 'PUT',
      body: data, // note: should be stringified before being sent to rest.put()
      headers: headers,
      agent: isSSL(url) ? agent : null
    }).then(() => ({ result: 'success', url }))
      .catch((e) => ({ result: 'error', url, message: e.message })));
    // we don't care about the data returned from the PUT, but we do care it it worked or not
  });
}

module.exports.get = get;
module.exports.put = put;

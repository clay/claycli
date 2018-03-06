'use strict';
const fetch = require('isomorphic-fetch'),
  h = require('highland'),
  _ = require('lodash'),
  nodeUrl = require('url'),
  https = require('https'),
  b64 = require('base-64'),
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
    return error;
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
 * @param  {string} url
 * @param  {object} options
 * @param {object} [options.headers]
 * @param {string} [options.type] defaults to json, can be json or text
 * @return {Stream}
 */
function get(url, options = {}) {
  options.type = options.type || 'json';
  log.debug(`GET ${url}`);
  return h(send(url, {
    method: 'GET',
    headers: options.headers,
    agent: isSSL(url) ? agent : null
  }).then((res) => {
    if (res instanceof Error) {
      res.url = url; // capture urls that we error on
      return res;
    } else {
      return res[options.type]();
    }
  }));
}

/**
 * PUT api call
 * @param  {string} url
 * @param {object} data
 * @param  {object} options
 * @param {string} options.key api key
 * @param {object} [options.headers]
 * @param {string} [options.type] defaults to json, can be json or text
 * @return {Stream}
 */
function put(url, data, options = {}) {
  let headers, body;

  if (!options.key) {
    throw new Error('Please specify API key to do PUT requests against Clay!');
  }

  options.type = options.type || 'json';
  headers = _.assign({
    'Content-Type': CONTENT_TYPES[options.type],
    Authorization: `Token ${options.key}`
  }, options.headers);

  // send stringified json, text, or empty (for @publish)
  if (data && options.type === 'json') {
    body = JSON.stringify(data);
  } else if (data) {
    body = data;
  } else {
    body = undefined;
  }

  log.debug(`PUT ${url}`);
  return h(send(url, {
    method: 'PUT',
    body: body,
    headers: headers,
    agent: isSSL(url) ? agent : null
  }).then((res) => {
    if (res instanceof Error) {
      return { result: 'error', url, message: res.message };
    } else {
      return { result: 'success', url };
    }
  }));
  // we don't care about the data returned from the PUT, but we do care it it worked or not
}

/**
 * POST to an elastic endpoint with a query
 * @param  {string} url of the endpoint
 * @param  {object} query
 * @param  {object} options
 * @param  {string} options.key
 * @param {object} [options.headers]
 * @return {Stream}
 */
function query(url, query, options = {}) {
  let headers;

  if (!options.key) {
    throw new Error('Please specify API key to do POST requests against Clay!');
  }

  headers = _.assign({
    'Content-Type': CONTENT_TYPES.json,
    Authorization: `Token ${options.key}`
  }, options.headers);

  log.debug(`POST ${url}`);
  return h(send(url, {
    method: 'POST',
    body: JSON.stringify(query),
    headers: headers,
    agent: isSSL(url) ? agent : null
  }).then((res) => {
    if (res instanceof Error) {
      return { result: 'error', url, message: res.message };
    } else {
      return res.json().then((obj) => ({ result: 'success', url, data: _.map(_.get(obj, 'hits.hits', []), (hit) => hit._source), total: _.get(obj, 'hits.total') }));
    }
  }));
}

/**
 * try fetching <some prefix>/_uris until it works (or it reaches the bare hostname)
 * @param  {string} currentURL to check
 * @param  {string} publicURI  that corresponds with a page uri
 * @param  {object} options
 * @return {Promise}
 */
function recursivelyCheckURI(currentURL, publicURI, options) {
  let urlArray = currentURL.split('/'),
    possiblePrefix, possibleUrl;

  urlArray.pop();
  possiblePrefix = urlArray.join('/');
  possibleUrl = `${possiblePrefix}/_uris/${b64.encode(publicURI)}`;

  return send(possibleUrl, {
    method: 'GET',
    headers: options.headers,
    agent: isSSL(possibleUrl) ? agent : null
  }).then((res) => res.text())
    .then((uri) => ({ uri, prefix: possiblePrefix })) // return page uri and the prefix we discovered
    .catch(() => {
      if (possiblePrefix.match(/^https?:\/\/[^\/]*$/)) {
        return Promise.reject(new Error(`Unable to find a Clay api for ${publicURI}`));
      } else {
        return recursivelyCheckURI(possiblePrefix, publicURI, options);
      }
    });
}

/**
 * given a public url, do GET requests against possible api endpoints until <prefix>/_uris is found,
 * then do requests against that until a page uri is resolved
 * note: because of the way Clay mounts sites on top of other sites,
 * this begins with the longest possible path and cuts it down (via /) until <path>/_uris is found
 * @param  {string} url
 * @param {object} [options]
 * @return {Stream}
 */
function findURI(url, options = {}) {
  const parts = nodeUrl.parse(url),
    publicURI = parts.hostname + parts.pathname;

  return h(recursivelyCheckURI(url, publicURI, options));
}

module.exports.get = get;
module.exports.put = put;
module.exports.query = query;
module.exports.findURI = findURI;

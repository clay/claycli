/* global fetch:false */

'use strict';
const h = require('highland'),
  _ = require('lodash'),
  nodeUrl = require('url'),
  https = require('https'),
  b64 = require('base-64'),
  pluralize = require('pluralize'),
  agent = new https.Agent({ rejectUnauthorized: false }), // allow self-signed certs
  CONTENT_TYPES = {
    json: 'application/json; charset=UTF-8',
    text: 'text/plain; charset=UTF-8'
  };

// isormorphic-fetch sets a global
require('isomorphic-fetch');

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
 * GET api call (async)
 * @param  {string} url
 * @param  {object} options
 * @param {object} [options.headers]
 * @param {string} [options.type] defaults to json, can be json or text
 * @return {Promise}
 */
async function getAsync(url, options) {
  var type, res;

  options = options || {};
  type = options.type || 'json';
  res = await send(url, {
    method: 'GET',
    headers: options.headers,
    agent: isSSL(url) ? agent : null
  });

  if (res instanceof Error) {
    res.url = url; // capture urls that we error on
    return res;
  }
  return res[type]();
}

/**
 * PUT api call (async)
 * @param  {string} url
 * @param {object} data
 * @param  {object} options
 * @param {string} options.key api key
 * @param {object} [options.headers]
 * @param {string} [options.type] defaults to json, can be json or text
 * @return {Promise}
 */
/**
 * determine body for PUT request
 * @param {*} data
 * @param {string} type
 * @return {string|undefined}
 */
function formatPutBody(data, type) {
  if (data && type === 'json') {
    return JSON.stringify(data);
  } else if (data) {
    return data;
  }
  return undefined;
}

function putAsync(url, data, options) {
  var headers, body;

  options = options || {};

  if (!options.key) {
    throw new Error('Please specify API key to do PUT requests against Clay!');
  }

  options.type = options.type || 'json';
  headers = _.assign({
    'Content-Type': CONTENT_TYPES[options.type],
    Authorization: `Token ${options.key}`
  }, options.headers);
  body = formatPutBody(data, options.type);

  return send(url, {
    method: 'PUT',
    body: body,
    headers: headers,
    agent: isSSL(url) ? agent : null
  }).then((res) => {
    if (res instanceof Error) {
      return { type: 'error', details: url, message: res.message };
    }
    return { type: 'success', message: url };
  });
}

/**
 * POST to an elastic endpoint with a query (async)
 * @param  {string} url of the endpoint
 * @param  {object} queryObj
 * @param  {object} options
 * @param  {string} options.key
 * @param {object} [options.headers]
 * @return {Promise}
 */
/**
 * process elastic query response
 * @param {object} res
 * @param {string} url
 * @return {Promise}
 */
function processQueryResponse(res, url) {
  if (res instanceof Error) {
    return Promise.resolve({ type: 'error', details: url, message: res.message });
  }

  if (_.includes(res.headers.get('content-type'), 'text/html')) {
    // elastic error, returned as 200 and raw text
    return res.text().then((str) => ({
      type: 'error',
      message: str.slice(0, str.indexOf(' ::')),
      details: url,
      url
    }));
  }

  return res.json().then((obj) => {
    if (_.get(obj, 'hits.total')) {
      return {
        type: 'success',
        message: pluralize('result', _.get(obj, 'hits.total'), true),
        details: url,
        data: _.map(_.get(obj, 'hits.hits', []), (hit) => _.assign(hit._source, { _id: hit._id })),
        total: _.get(obj, 'hits.total')
      };
    }
    // no results!
    return {
      type: 'error',
      message: 'No results',
      details: url,
      url
    };
  });
}

function queryAsync(url, queryObj, options) {
  var headers;

  options = options || {};

  if (!options.key) {
    throw new Error('Please specify API key to do POST requests against Clay!');
  }

  headers = _.assign({
    'Content-Type': CONTENT_TYPES.json,
    Authorization: `Token ${options.key}`
  }, options.headers);

  return send(url, {
    method: 'POST',
    body: JSON.stringify(queryObj),
    headers: headers,
    agent: isSSL(url) ? agent : null
  }).then((res) => processQueryResponse(res, url));
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
 * @return {Promise}
 */
function findURIAsync(url, options) {
  var parts = nodeUrl.parse(url),
    publicURI = parts.hostname + parts.pathname;

  options = options || {};
  return recursivelyCheckURI(url, publicURI, options);
}

/**
 * determine if url is a proper elastic endpoint prefix (async)
 * @param  {string} url
 * @return {Promise}
 */
async function isElasticPrefixAsync(url) {
  var res = await send(`${url}/_components`, {
    method: 'GET',
    agent: isSSL(url) ? agent : null
  });

  return !(res instanceof Error);
}

// Highland stream adapter for backward compatibility
// NOTE: This adapter will be removed after lint.js, export.js, and import.js
// are converted to async/await in p03-t03.
function toStream(asyncFn) {
  return function () {
    return h(asyncFn.apply(null, arguments));
  };
}

// Highland-wrapped exports (backward compat for lint.js, export.js, import.js)
module.exports.get = toStream(getAsync);
module.exports.put = toStream(putAsync);
module.exports.query = toStream(queryAsync);
module.exports.findURI = toStream(findURIAsync);
module.exports.isElasticPrefix = toStream(isElasticPrefixAsync);

// Promise-based exports (new API — use these in updated consumers)
module.exports.getAsync = getAsync;
module.exports.putAsync = putAsync;
module.exports.queryAsync = queryAsync;
module.exports.findURIAsync = findURIAsync;
module.exports.isElasticPrefixAsync = isElasticPrefixAsync;

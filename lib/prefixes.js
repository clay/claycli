'use strict';
const _ = require('lodash'),
  replace = require('string-replace-async'),
  h = require('highland'),
  types = [
    '/_components',
    '/_pages',
    '/_users',
    '/_uris',
    '/_lists'
  ];

;

/**
 * add prefixes to a stream of dispatches
 * @param {Stream} stream of dispatches
 * @param {string} prefix
 * @returns {Stream}
 */
function add(stream, prefix) {
  return stream.flatMap((dispatch) => {
    const stringDispatch = JSON.stringify(dispatch);

    return h(replace(stringDispatch, /"\/_?(components|uris|pages|lists|users)/g, (match, type) => Promise.resolve(`"${prefix}/_${type}`))).map(JSON.parse);
  });
}

/**
 * remove prefixes from a stream of dispatches
 * @param  {stream} stream of dispatches
 * @param  {string} prefix
 * @return {Stream}
 */
function remove(stream, prefix) {
  return stream.flatMap((dispatch) => {
    const stringDispatch = JSON.stringify(dispatch);

    return h(replace(stringDispatch, new RegExp(`"${prefix}`, 'g'), '"')).map(JSON.parse);
  });
}

/**
 * get site prefix from url
 * note: only works on api routes
 * @param  {string} url
 * @return {string}
 */
function getFromUrl(url) {
  let type = _.find(types, (t) => _.includes(url, t));

  if (type) {
    return url.slice(0, url.indexOf(type));
  } else {
    throw new Error(`Unable to find site prefix for ${url}`);
  }
}

/**
 * convert uri to url, using prefix provided
 * @param  {string} prefix
 * @param  {string} uri
 * @return {string}
 */
function uriToUrl(prefix, uri) {
  let type = _.find(types, (t) => _.includes(uri, t)),
    parts = uri.split(type),
    path = parts[1];

  return `${prefix}${type}${path}`;
}

module.exports.add = add;
module.exports.remove = remove;
module.exports.getFromUrl = getFromUrl;
module.exports.uriToUrl = uriToUrl;

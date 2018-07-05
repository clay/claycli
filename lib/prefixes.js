'use strict';
const _ = require('lodash'),
  nodeUrl = require('url'),
  replace = require('string-replace-async'),
  h = require('highland'),
  b64 = require('base-64'),
  types = require('./types');

/**
 * add prefixes
 * @param {object} dispatch
 * @param {string} prefix
 * @returns {Stream}
 */
function add(dispatch, prefix) {
  const stringDispatch = JSON.stringify(dispatch);

  let urlPrefix = prefix;

  if (_.includes(prefix, 'http')) {
    // make sure it's a uri
    prefix = urlToUri(prefix);
  }

  return h(replace(stringDispatch, /"\/_?(components|uris|pages|lists|users|layouts)(\/[\w-\/]*)/g, (match, type, name) => {
    if (type === 'uris') {
      return Promise.resolve(`"${prefix}/_${type}/${b64.encode(prefix + name)}`);
    } else {
      return Promise.resolve(`"${prefix}/_${type}${name}`);
    }
  }).then((prefixedString) => replace(prefixedString, /"customUrl":"(.*)"/g, (match, uri) => Promise.resolve(`"customUrl":"${urlPrefix}${uri}"`)))).map(JSON.parse);
}

/**
 * remove prefixes
 * @param  {object} dispatch
 * @param  {string} prefix
 * @return {Stream}
 */
function remove(dispatch, prefix) {
  const stringDispatch = JSON.stringify(dispatch);

  let urlPrefix = prefix;

  if (_.includes(prefix, 'http')) {
    // make sure it's a uri
    prefix = urlToUri(prefix);
  }

  return h(replace(stringDispatch, new RegExp(`"${prefix}\/_?(components|uris|pages|lists|users|layouts)/(.+?)"`, 'g'), (match, type, end) => {
    if (type === 'uris') {
      return Promise.resolve(`"/_${type}${b64.decode(end).replace(prefix, '')}"`);
    } else {
      return Promise.resolve(`"/_${type}/${end}"`);
    }
  }).then((unprefixedString) => replace(unprefixedString, /"customUrl":"(.*)"/g, (match, prefixedURI) => Promise.resolve(`"customUrl":"${prefixedURI.replace(urlPrefix, '')}"`)))).map(JSON.parse);
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

/**
 * convert url to uri
 * and removes extension
 * @param  {string} url
 * @return {string}
 */
function urlToUri(url) {
  const parts = nodeUrl.parse(url);

  let path;

  if (parts.pathname === '/') {
    path = '';
  } else if (_.includes(parts.pathname, '.')) {
    path = parts.pathname.slice(0, parts.pathname.indexOf('.'));
  } else {
    path = parts.pathname;
  }

  return parts.hostname + path;
}

/**
 * get extension from url
 * @param  {string} url
 * @return {string|null} e.g. '.json' or '.html'
 */
function getExt(url) {
  const parts = nodeUrl.parse(url);

  if (_.includes(parts.pathname, '.')) {
    return parts.pathname.slice(parts.pathname.indexOf('.'));
  } else {
    return null;
  }
}

module.exports.add = add;
module.exports.remove = remove;
module.exports.getFromUrl = getFromUrl;
module.exports.uriToUrl = uriToUrl;
module.exports.urlToUri = urlToUri;
module.exports.getExt = getExt;

'use strict';
const _ = require('lodash'),
  nodeUrl = require('url'),
  replace = require('string-replace-async'),
  h = require('highland'),
  b64 = require('base-64'),
  types = require('./types'),
  PROTOCOL = /^https?:\/\//i,
  ORIGIN = /^https?:\/\/[^/]+/i,
  SITE_PATH = /^\/(?!\/)/; // starts with a single slash, not a protocol-relative //host

/**
 * add prefixes
 * @param {object} dispatch
 * @param {string} prefix
 * @returns {Stream}
 */
function add(dispatch, prefix) {
  const stringDispatch = JSON.stringify(dispatch),
    isPage = _.some(_.keys(dispatch), (uri) => /(^|\/)_pages\//.test(uri));

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
  }).then((prefixedString) => replace(prefixedString, /"(customUrl|url)":"([^"]*)"/g, (match, prop, uri) => {
    return Promise.resolve(`"${prop}":"${addSite(uri, urlPrefix, isPage)}"`);
  }))).map(JSON.parse);
}

/**
 * put the site back on a url that `remove` made relative to it
 * only a path on the site is touched: absolute urls (external links, images, other sites),
 * #anchors, mailto: links and //cdn urls are left as they are.
 * the exception is a page's own url, which always lives on the site it's imported to,
 * so an absolute one (e.g. importing without prior export strip) moves to the target origin
 * @param  {string} url
 * @param  {string} urlPrefix site prefix, with or without a protocol
 * @param  {boolean} isPage whether the url is a page's own url or customUrl
 * @return {string}
 */
function addSite(url, urlPrefix, isPage) {
  if (PROTOCOL.test(url)) {
    const targetOrigin = urlPrefix.match(/^(https?:\/\/[^/]+)/i);

    return isPage && targetOrigin ? `${targetOrigin[1]}${url.replace(ORIGIN, '')}` : url;
  }

  return SITE_PATH.test(url) ? `${urlPrefix}${url}` : url;
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
  }).then((unprefixedString) => replace(unprefixedString, /"(customUrl|url)":"([^"]*)"/g, (match, prop, prefixedURI) => {
    return Promise.resolve(`"${prop}":"${stripSite(prefixedURI, urlPrefix)}"`);
  }))).map(JSON.parse);
}

/**
 * get the host (and port) of a url or site prefix, with or without a protocol
 * @param  {string} url
 * @return {string}
 */
function getHost(url) {
  return url.replace(PROTOCOL, '').split(/[/?#]/)[0].toLowerCase();
}

/**
 * strip the site from a url, leaving the path relative to the site
 * a url on the site's host (whatever the protocol) loses its origin and the site's own path,
 * e.g. the site https://nymag.com/strategist has the page https://nymag.com/strategist/article/foo.html,
 * and `add` puts the whole site prefix back in front of what's left.
 * a url on any other host (external links, images, other sites) is not the site's to move
 * @param  {string} url
 * @param  {string} urlPrefix site prefix, with or without a protocol
 * @return {string}
 */
function stripSite(url, urlPrefix) {
  if (!PROTOCOL.test(url)) {
    return url.replace(urlPrefix, '');
  } else if (getHost(url) !== getHost(urlPrefix)) {
    return url;
  }

  const sitePath = urlPrefix.replace(/^(https?:\/\/)?[^/]+/i, ''),
    path = url.replace(ORIGIN, '');

  // only drop the site path at a path boundary, so /strategist doesn't eat the start of /strategist-100
  if (sitePath && path.startsWith(sitePath) && /^([/?#]|$)/.test(path.slice(sitePath.length))) {
    return path.slice(sitePath.length);
  }

  return path;
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

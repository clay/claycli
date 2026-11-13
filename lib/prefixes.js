'use strict';
const _ = require('lodash'),
  nodeUrl = require('url'),
  replace = require('string-replace-async'),
  h = require('highland'),
  b64 = require('base-64'),
  types = require('./types'),
  PROTOCOL = /^https?:\/\//i,
  ORIGIN = /^https?:\/\/[^/?#]+/i, // stops at a ?query or #fragment too, which can follow the host with no path in between
  SITE_PATH = /^\/(?!\/)/, // starts with a single slash, not a protocol-relative //host
  SECOND_LEVEL = /^(ac|co|com|edu|gov|ne|net|or|org)$/, // the label below a country code that is part of the public suffix, e.g. co.uk
  IP_ADDRESS = /^(\d+(\.\d+){3}|\[[^\]]*\])$/; // an ipv4 address, or an ipv6 literal in its brackets

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
    return Promise.resolve(`"${prop}":"${addSite(uri, urlPrefix, isPage, prop)}"`);
  }))).map(JSON.parse);
}

/**
 * whether a value is the `url` of a page that stands for the bare site, https://host, which is exported as an
 * empty string. nothing else is: an empty customUrl means there is none, and so does an empty value anywhere
 * but in a page
 * @param  {boolean} isPage whether the url is in a page
 * @param  {string} prop the property the url is in, url or customUrl
 * @param  {string} value the url as exported (the site taken off) or as imported
 * @return {boolean}
 */
function isPageSiteUrl(isPage, prop, value) {
  return isPage && prop === 'url' && value === '';
}

/**
 * put the site back on a url
 * a path on the site gets the site's prefix, and an absolute url on the site (e.g. importing without
 * prior export strip) moves to the target origin. a page's own url always lives on the site it's
 * imported to, so it moves even when it isn't on the site.
 * the one exception to 6.0.0-rc.12's "the site itself is /" is the `url` of a page: when it is the bare site,
 * https://host, it is exported as an empty string, as it was before rc.12, and comes back as https://host.
 * amphora keeps every url a page was published at and treats https://host and https://host/ as two different
 * ones, so changing the form of a page that is already published in the target is not harmless.
 * a customUrl does not get that meaning: an empty customUrl means there is none, like every other empty value,
 * and stays empty
 * everything else is left as it is: absolute urls to external links, images and other sites,
 * #anchors, mailto: links, //cdn urls and empty values that aren't the url of a page
 * @param  {string} url
 * @param  {string} urlPrefix site prefix, with or without a protocol
 * @param  {boolean} isPage whether the url is in a page, where an absolute url moves to the target origin
 * @param  {string} prop the property the url is in, url or customUrl
 * @return {string}
 */
function addSite(url, urlPrefix, isPage, prop) {
  if (PROTOCOL.test(url)) {
    const targetOrigin = urlPrefix.match(ORIGIN);

    return targetOrigin && (isPage || isOnSite(url, urlPrefix)) ? `${targetOrigin[0]}${url.replace(ORIGIN, '')}` : url;
  }

  return SITE_PATH.test(url) || isPageSiteUrl(isPage, prop, url) ? `${urlPrefix}${url}` : url;
}

/**
 * remove prefixes
 * a dispatch with no site prefix to remove (exporting a public url, which already took off the site it found)
 * is returned as it is
 * @param  {object} dispatch
 * @param  {string} [prefix]
 * @return {Stream}
 */
function remove(dispatch, prefix) {
  if (!prefix) {
    return h([dispatch]);
  }

  const stringDispatch = JSON.stringify(dispatch),
    isPage = _.some(_.keys(dispatch), (uri) => /(^|\/)_pages\//.test(uri));

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
    return Promise.resolve(`"${prop}":"${stripSite(prefixedURI, urlPrefix, isPage, prop)}"`);
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
 * get a host without its port, keeping the colons of an ipv6 literal: [2001:db8::1]:3001 is [2001:db8::1]
 * @param  {string} host
 * @return {string}
 */
function getHostname(host) {
  return /^(\[[^\]]*\]|[^:]*)/.exec(host)[0];
}

/**
 * get the domain of a host, e.g. nymag.com for stg.nymag.com:3001, and example.co.uk for www.example.co.uk
 * country domains register one level lower (co.uk, com.au), so that level is part of what is shared.
 * this is a rule of thumb for the common cases, not the public suffix list, and an ip address is its own domain
 * @param  {string} host
 * @return {string}
 */
function getDomain(host) {
  const name = getHostname(host),
    labels = name.split('.'),
    isSecondLevel = labels.length > 2 && labels[labels.length - 1].length === 2 && SECOND_LEVEL.test(labels[labels.length - 2]);

  return IP_ADDRESS.test(name) ? name : labels.slice(isSecondLevel ? -3 : -2).join('.');
}

/**
 * get the path a site is mounted on, e.g. /strategist for https://nymag.com/strategist
 * @param  {string} urlPrefix site prefix, with or without a protocol
 * @return {string} empty if the site is on the root of its host
 */
function getSitePath(urlPrefix) {
  return urlPrefix.replace(/^(https?:\/\/)?[^/]+/i, '').replace(/\/+$/, '');
}

/**
 * whether a path is the site's path or inside it, so /strategist doesn't match /strategist-100
 * @param  {string} path
 * @param  {string} sitePath
 * @return {boolean}
 */
function isInSitePath(path, sitePath) {
  return path.startsWith(sitePath) && /^([/?#]|$)/.test(path.slice(sitePath.length));
}

/**
 * whether an absolute url is on the site: on its host, or on another host of the same domain
 * (e.g. nymag.com for the site https://stg.nymag.com/strategist) that is the site's and not another
 * service's, like the images on pyxis.nymag.com or the media kit on mediakit.nymag.com.
 * a site mounted on a path is told from the rest of its host and domain by the path (a sister site on
 * nymag.com/intelligencer is not on nymag.com/strategist, even on the same host), and a site on the root
 * of its host by the host being the site's own, the domain itself or its www.
 * hosts are compared without their port, so https://stg.nymag.com:443 and https://stg.nymag.com are the same
 * @param  {string} url
 * @param  {string} urlPrefix site prefix, with or without a protocol
 * @return {boolean}
 */
function isOnSite(url, urlPrefix) {
  const hostname = getHostname(getHost(url)),
    siteHostname = getHostname(getHost(urlPrefix)),
    sitePath = getSitePath(urlPrefix),
    domain = getDomain(hostname);

  if (domain !== getDomain(siteHostname)) {
    return false;
  } else if (sitePath) {
    return isInSitePath(url.replace(ORIGIN, ''), sitePath);
  }

  return hostname === siteHostname || _.includes([domain, `www.${domain}`], hostname);
}

/**
 * strip the site from a url, leaving the path relative to the site
 * a url on the site loses its origin (whatever the protocol) and the site's own path,
 * e.g. the site https://nymag.com/strategist has the page https://nymag.com/strategist/article/foo.html,
 * and `add` puts the whole site prefix back in front of what's left.
 * what's left starts at the site root, so the site itself, a ?query and a #fragment come out as /, /?query
 * and /#fragment instead of something `add` would read as no path at all (it leaves an empty value alone).
 * the exception is the `url` of a page when it is the bare site, https://host: it is exported as an empty string
 * (https://host/ is still /), and `add` brings the empty string back as https://host. a customUrl that is the
 * bare site comes out as / too, because an empty customUrl means there is none
 * a url that isn't on the site (external links, images, other sites, sister sites) is not the site's to move
 * @param  {string} url
 * @param  {string} urlPrefix site prefix, with or without a protocol
 * @param  {boolean} isPage whether the url is in a page
 * @param  {string} prop the property the url is in, url or customUrl
 * @return {string}
 */
function stripSite(url, urlPrefix, isPage, prop) {
  if (!PROTOCOL.test(url)) {
    return url.replace(urlPrefix, '');
  } else if (!isOnSite(url, urlPrefix)) {
    return url;
  }

  const sitePath = getSitePath(urlPrefix),
    path = url.replace(ORIGIN, ''),
    rest = sitePath ? path.slice(sitePath.length) : path;

  return isPageSiteUrl(isPage, prop, rest) ? '' : `/${rest.replace(/^\/+/, '')}`;
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

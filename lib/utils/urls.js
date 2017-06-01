'use strict';

const nodeUrl = require('url'),
  _ = require('lodash'),
  types = [
    '/components',
    '/uris',
    '/pages',
    '/lists',
    '/users'
  ];

/**
 * convert a url to uri, removing protocol and port
 * @param  {string} url
 * @return {string}
 */
function urlToUri(url) {
  const parts = nodeUrl.parse(url),
    path = parts.pathname === '/' ? '' : parts.pathname;

  return parts.hostname + path;
}

/**
 * get the site prefix, with protocol and port
 * used for determining the correct url to PUT data to for children
 * @param  {string} url e.g. http://my-site:3001/path/components/foo
 * @return {string}     e.g. http://my-site:3001/path
 */
function getUrlPrefix(url) {
  const urlType = _.find(types, (type) => _.includes(url, type));

  if (urlType) {
    const parts = url.split(urlType);

    return { prefix: parts[0], path: `${urlType}${parts[1]}` };
  } else {
    throw new Error('Cannot parse url for site prefix!');
  }
}

/**
 * convert uri to url, using specified prefix
 * if prefix is null, it will use the prefix from the uri/url
 * @param  {string|null} [prefix]
 * @param  {string} uri
 * @return {string}
 */
function uriToUrl(prefix, uri) {
  const parts = getUrlPrefix(uri);

  prefix = prefix || parts.prefix;
  return `${prefix}${parts.path}`;
}

module.exports.urlToUri = urlToUri;
module.exports.getUrlPrefix = getUrlPrefix;
module.exports.uriToUrl = uriToUrl;

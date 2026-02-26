import _ from 'lodash';

const replace = require('string-replace-async');
import types = require('./types');

/**
 * add prefixes
 */
function add(dispatch: Record<string, unknown>, prefix: string): Promise<Record<string, unknown>> {
  const stringDispatch = JSON.stringify(dispatch);

  let urlPrefix = prefix;

  if (_.includes(prefix, 'http')) {
    // make sure it's a uri
    prefix = urlToUri(prefix);
  }

  return replace(stringDispatch, /"\/_?(components|uris|pages|lists|users|layouts)(\/[\w-\/]*)/g, (match: string, type: string, name: string) => {
    if (type === 'uris') {
      return Promise.resolve(`"${prefix}/_${type}/${Buffer.from(prefix + name).toString('base64')}`);
    } else {
      return Promise.resolve(`"${prefix}/_${type}${name}`);
    }
  }).then((prefixedString: string) => replace(prefixedString, /"customUrl":"(.*)"/g, (match: string, uri: string) => Promise.resolve(`"customUrl":"${urlPrefix}${uri}"`))).then(JSON.parse);
}

/**
 * remove prefixes
 */
function remove(dispatch: Record<string, unknown>, prefix: string): Promise<Record<string, unknown>> {
  const stringDispatch = JSON.stringify(dispatch);

  let urlPrefix = prefix;

  if (_.includes(prefix, 'http')) {
    // make sure it's a uri
    prefix = urlToUri(prefix);
  }

  return replace(stringDispatch, new RegExp(`"${prefix}\/_?(components|uris|pages|lists|users|layouts)/(.+?)"`, 'g'), (match: string, type: string, end: string) => {
    if (type === 'uris') {
      return Promise.resolve(`"/_${type}${Buffer.from(end, 'base64').toString().replace(prefix, '')}"`);
    } else {
      return Promise.resolve(`"/_${type}/${end}"`);
    }
  }).then((unprefixedString: string) => replace(unprefixedString, /"customUrl":"(.*)"/g, (match: string, prefixedURI: string) => Promise.resolve(`"customUrl":"${prefixedURI.replace(urlPrefix, '')}"`))).then(JSON.parse);
}

/**
 * get site prefix from url
 * note: only works on api routes
 */
function getFromUrl(url: string): string {
  const type = _.find(types, (t) => _.includes(url, t));

  if (type) {
    return url.slice(0, url.indexOf(type));
  } else {
    throw new Error(`Unable to find site prefix for ${url}`);
  }
}

/**
 * convert uri to url, using prefix provided
 */
function uriToUrl(prefix: string, uri: string): string {
  const type = _.find(types, (t) => _.includes(uri, t)) as string,
    parts = uri.split(type),
    path = parts[1];

  return `${prefix}${type}${path}`;
}

/**
 * safely parse a URL, prepending http:// for schemeless inputs
 */
function safeParseUrl(url: string): URL {
  try {
    return new URL(url);
  } catch (_e) {
    return new URL('http://' + url);
  }
}

/**
 * convert url to uri
 * and removes extension
 */
function urlToUri(url: string): string {
  const parts = safeParseUrl(url),
    host = parts.hostname;

  let path: string;

  if (parts.pathname === '/') {
    path = '';
  } else if (_.includes(parts.pathname, '.')) {
    path = parts.pathname.slice(0, parts.pathname.indexOf('.'));
  } else {
    path = parts.pathname;
  }

  return host + path;
}

/**
 * get extension from url
 */
function getExt(url: string): string | null {
  const parts = safeParseUrl(url);

  if (_.includes(parts.pathname, '.')) {
    return parts.pathname.slice(parts.pathname.indexOf('.'));
  } else {
    return null;
  }
}

export { add, remove, getFromUrl, uriToUrl, urlToUri, getExt };

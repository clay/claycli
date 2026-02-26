'use strict';
const _ = require('lodash'),
  utils = require('clayutils'),
  yaml = require('js-yaml'),
  config = require('./config'),
  prefixes = require('../prefixes'),
  rest = require('../rest'),
  { mapConcurrent } = require('../concurrency'),
  refProp = '_ref';

/**
 * expand references in component lists
 * @param  {array} val
 * @return {array}
 */
function expandListReferences(val) {
  if (_.has(_.head(val), refProp)) {
    // component list! return the references
    return _.map(val, (item) => item[refProp]);
  } else {
    return [];
  }
}

/**
 * expand references in component properties
 * @param  {object} val
 * @return {array}
 */
function expandPropReferences(val) {
  if (_.has(val, refProp)) {
    return [val[refProp]];
  } else {
    return [];
  }
}

/**
 * list all references in a component
 * @param  {object} data
 * @return {array} of uris
 */
function listComponentReferences(data) {
  return _.reduce(data, (result, val) => {
    if (_.isArray(val)) {
      return result.concat(expandListReferences(val));
    } else if (_.isObject(val)) {
      return result.concat(expandPropReferences(val));
    } else {
      return result;
    }
  }, []);
}

/**
 * recursively check children
 * @param  {array} children
 * @param  {string} prefix
 * @param  {number} concurrency
 * @param  {string} ext
 * @return {Promise<array>}
 */
async function checkChildren(children, prefix, concurrency, ext) {
  var allResults = await mapConcurrent(children, concurrency, (child) => {
    return checkComponent(child, prefix, concurrency, ext);
  });

  return _.flatten(allResults);
}

/**
 * check a broken component (composed json failed)
 * @param  {string} url
 * @param  {string} prefix
 * @param  {number} concurrency
 * @param  {string} ext
 * @return {Promise<array>}
 */
async function checkBrokenComponent(url, prefix, concurrency, ext) {
  var dataRes, children, childResults;

  dataRes = await rest.get(url);
  if (dataRes instanceof Error) {
    return [{ type: 'error', message: dataRes.url }];
  }
  children = listComponentReferences(dataRes);
  childResults = await checkChildren(children, prefix, concurrency, ext);
  return [{ type: 'success', message: url }].concat(childResults);
}

/**
 * check a component whose rendered version is broken
 * @param  {string} url
 * @param  {string} prefix
 * @param  {number} concurrency
 * @param  {string} ext
 * @return {Promise<array>}
 */
async function checkBrokenRender(url, prefix, concurrency, ext) {
  var dataRes, children, results, childResults;

  dataRes = await rest.get(url);
  if (dataRes instanceof Error) {
    return [{ type: 'error', message: dataRes.url }];
  }
  children = listComponentReferences(dataRes);
  results = [
    { type: 'error', message: `${url}${ext}` },
    { type: 'success', message: url }
  ];
  childResults = await checkChildren(children, prefix, concurrency, ext);
  return results.concat(childResults);
}

/**
 * check a component whose composed json is OK but has an extension to verify
 * @param  {string} url
 * @param  {string} prefix
 * @param  {number} concurrency
 * @param  {string} ext
 * @return {Promise<array>}
 */
async function checkRendered(url, prefix, concurrency, ext) {
  var renderRes = await rest.get(`${url}${ext}`, { type: 'text' });

  if (renderRes instanceof Error) {
    return checkBrokenRender(url, prefix, concurrency, ext);
  }
  return [{ type: 'success', message: `${url}${ext}` }];
}

/**
 * normalize a url/uri input, extracting extension if present
 * @param  {*} url
 * @param  {string} prefix
 * @param  {string} ext
 * @return {object} { url, ext, passthrough }
 */
function normalizeComponentUrl(url, prefix, ext) {
  ext = ext || '';
  if (_.isObject(url)) {
    return { passthrough: [url] };
  } else if (_.isString(url) && !_.includes(url, 'http')) {
    url = prefixes.uriToUrl(prefix, url);
  }

  if (!ext.length && _.isString(url) && prefixes.getExt(url)) {
    ext = prefixes.getExt(url);
    url = url.slice(0, url.indexOf(ext));
  }
  return { url, ext };
}

/**
 * recursively check all references in a component or layout
 * @param  {*} url
 * @param {string} prefix
 * @param  {number} concurrency
 * @param {string} ext
 * @return {Promise<array>}
 */
async function checkComponent(url, prefix, concurrency, ext) {
  var normalized = normalizeComponentUrl(url, prefix, ext),
    composedRes;

  if (normalized.passthrough) {
    return normalized.passthrough;
  }
  url = normalized.url;
  ext = normalized.ext;

  composedRes = await rest.get(`${url}.json`);
  if (composedRes instanceof Error) {
    return checkBrokenComponent(url, prefix, concurrency, ext);
  } else if (ext.length) {
    return checkRendered(url, prefix, concurrency, ext);
  }
  return [{ type: 'success', message: `${url}${ext}` }];
}

/**
 * check broken page (composed json failed)
 * @param  {string} url
 * @param {string} prefix
 * @param  {number} concurrency
 * @param  {string} ext
 * @return {Promise<array>}
 */
async function checkPageBroken(url, prefix, concurrency, ext) {
  var dataRes, layout, children, results, childResults;

  dataRes = await rest.get(url);
  if (dataRes instanceof Error) {
    return [{ type: 'error', message: dataRes.url }];
  }
  layout = dataRes.layout;
  children = _.reduce(dataRes, (uris, area) => _.isArray(area) ? uris.concat(area) : uris, []);
  children.unshift(layout);
  results = [{ type: 'success', message: url }];
  childResults = await checkChildren(children, prefix, concurrency, ext);
  return results.concat(childResults);
}

/**
 * check broken page render
 * @param  {string} url
 * @param {string} prefix
 * @param  {number} concurrency
 * @param  {string} ext
 * @return {Promise<array>}
 */
async function checkPageBrokenRender(url, prefix, concurrency, ext) {
  var dataRes, layout, children, results, childResults;

  dataRes = await rest.get(url);
  if (dataRes instanceof Error) {
    return [{ type: 'error', message: dataRes.url }];
  }
  layout = dataRes.layout;
  children = _.reduce(dataRes, (uris, area) => _.isArray(area) ? uris.concat(area) : uris, []);
  children.unshift(layout);
  results = [
    { type: 'error', message: `${url}${ext}` },
    { type: 'success', message: url }
  ];
  childResults = await checkChildren(children, prefix, concurrency, ext);
  return results.concat(childResults);
}

/**
 * check all references in a page
 * @param  {string} url
 * @param {string} prefix
 * @param  {number} concurrency
 * @return {Promise<array>}
 */
async function checkPage(url, prefix, concurrency) {
  var ext = '', composedRes, renderRes;

  if (_.isString(url) && prefixes.getExt(url)) {
    ext = prefixes.getExt(url);
    url = url.slice(0, url.indexOf(ext));
  }

  composedRes = await rest.get(`${url}.json`);
  if (composedRes instanceof Error) {
    return checkPageBroken(url, prefix, concurrency, ext);
  } else if (ext.length) {
    renderRes = await rest.get(`${url}${ext}`, { type: 'text' });
    if (renderRes instanceof Error) {
      return checkPageBrokenRender(url, prefix, concurrency, ext);
    }
    return [{ type: 'success', message: `${url}${ext}` }];
  }
  return [{ type: 'success', message: url }];
}

/**
 * determine the page uri, then run checks against it
 * @param  {string} url
 * @param  {number} concurrency
 * @return {Promise<array>}
 */
async function checkPublicUrl(url, concurrency) {
  var result, pageURL, pageResults;

  try {
    result = await rest.findURI(url);
    pageURL = prefixes.uriToUrl(result.prefix, result.uri);
    pageResults = await checkPage(`${pageURL}.html`, result.prefix, concurrency);
    return [{ type: 'success', message: url }].concat(pageResults);
  } catch (e) {
    return [{ type: 'error', message: e.url }];
  }
}

/**
 * lint a url, recursively determining if all components exist
 * @param  {string} rawUrl url or alias, will be run through config
 * @param  {object} options
 * @return {Promise<array>}
 */
function lintUrl(rawUrl, options) {
  var concurrency, url;

  options = options || {};
  concurrency = options.concurrency || 10;
  url = config.get('url', rawUrl);

  if (!url) {
    return Promise.resolve([{ type: 'error', message: 'URL is not defined! Please specify a url to lint' }]);
  }

  if (utils.isComponent(url) || utils.isLayout(url)) {
    return checkComponent(url, prefixes.getFromUrl(url), concurrency);
  } else if (utils.isPage(url)) {
    return checkPage(url, prefixes.getFromUrl(url), concurrency);
  } else {
    return checkPublicUrl(url, concurrency);
  }
}

/**
 * determine if a schema has a description
 * @param  {object} obj
 * @return {boolean}
 */
function noDescription(obj) {
  return !_.has(obj, '_description');
}

/**
 * Check if a string contains non-letter, non-number, or non-underscore chars
 *
 * @param  {string} str
 * @return {boolean}
 */
function isValidKilnDotNotation(str) {
  return !/[^\w\$_]/g.test(str);
}

/**
 * determine if a schema has camelCased props
 * @param  {obj} obj
 * @return {array}
 */
function nonCamelCasedProps(obj) {
  return _.reduce(obj, (errors, value, key) => {
    return !isValidKilnDotNotation(key) ? errors.concat(key) : errors;
  }, []);
}

/**
 * determine if a schema has groups that reference non-existant fields
 * @param  {obj} obj
 * @return {array}
 */
function nonexistentGroupFields(obj) {
  return _.reduce(_.get(obj, '_groups'), (errors, group, groupName) => {
    const fields = group.fields;

    _.each(fields, (field) => {
      if (!_.has(obj, field)) {
        errors.push(`${groupName} » ${field}`);
      }
    });
    return errors;
  }, []);
}

/**
 * lint schemas for:
 * - valid yaml syntax
 * - has _description
 * - all root-level properties are camelCase
 * - _group fields refer to existing properties
 * @param  {string} str of yaml
 * @return {Promise<array>}
 */
function lintSchema(str) {
  var obj, errors;

  try {
    obj = yaml.load(str);
  } catch (e) {
    return Promise.resolve([{ type: 'error', message: `YAML syntax error: ${e.message.slice(0, e.message.indexOf(':'))}` }]);
  }

  errors = [];
  if (noDescription(obj)) {
    errors.push({ type: 'error', message: 'Schema has no _description' });
  }
  if (nonCamelCasedProps(obj).length) {
    errors.push({ type: 'error', message: 'Properties must be camelCased', details: nonCamelCasedProps(obj).join('\n') });
  }
  if (nonexistentGroupFields(obj).length) {
    errors.push({ type: 'error', message: 'Fields referenced by groups don\'t exist', details: nonexistentGroupFields(obj).join('\n') });
  }

  if (errors.length) {
    return Promise.resolve(errors);
  }
  return Promise.resolve([{ type: 'success' }]);
}

module.exports.lintUrl = lintUrl;
module.exports.lintSchema = lintSchema;

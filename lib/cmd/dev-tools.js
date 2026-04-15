'use strict';
const _ = require('lodash'),
  pLimit = require('p-limit'),
  fs = require('fs-extra'),
  path = require('path'),
  config = require('./config'),
  prefixes = require('../prefixes'),
  rest = require('../rest'),
  exportCmd = require('./export'),
  importCmd = require('./import');

/**
 * Resolve an API key from a raw key or configured alias.
 * @param {string} keyAlias
 * @returns {string}
 */
function getKey(keyAlias) {
  return config.get('key', keyAlias);
}

/**
 * Resolve a URL/site prefix from a raw URL or configured alias.
 * @param {string} urlAlias
 * @returns {string}
 */
function getUrl(urlAlias) {
  return config.get('url', urlAlias);
}

/**
 * Resolve a page input (public URL or _pages URL) into normalized page metadata.
 * @param {string} rawUrl
 * @returns {Promise<object>}
 */
async function resolvePage(rawUrl) {
  const url = getUrl(rawUrl);

  if (!url) {
    throw new Error('URL is not defined! Please specify a page url or alias');
  }

  if (_.includes(url, '/_pages/')) {
    return {
      rawUrl: rawUrl,
      inputUrl: url,
      pageUrl: url.replace(/\.html$/, ''),
      pageUri: prefixes.urlToUri(url.replace(/\.html$/, '')),
      prefix: prefixes.getFromUrl(url.replace(/\.html$/, ''))
    };
  }

  const found = await rest.findURI(url).toPromise(Promise);

  if (found instanceof Error) {
    throw found;
  }

  return {
    rawUrl: rawUrl,
    inputUrl: url,
    pageUrl: prefixes.uriToUrl(found.prefix, found.uri),
    pageUri: found.uri,
    prefix: found.prefix
  };
}

/**
 * Build authorization headers for GET calls that require API auth.
 * @param {string} key
 * @returns {object|undefined}
 */
function authHeaders(key) {
  return key ? { Authorization: `Token ${key}` } : undefined;
}

/**
 * Fetch page JSON data and convert request errors into thrown exceptions.
 * @param {string} pageUrl
 * @param {string} key
 * @returns {Promise<object>}
 */
async function getPageData(pageUrl, key) {
  const res = await rest.get(pageUrl, { headers: authHeaders(key) }).toPromise(Promise);

  if (res instanceof Error) {
    throw res;
  }

  return res;
}

/**
 * Recursively collect `_ref` values and direct URI strings from page data.
 * @param {*} value
 * @param {Set<string>} [refs]
 * @returns {Set<string>}
 */
function listRefs(value, refs = new Set()) {
  if (_.isString(value) && _.startsWith(value, '/_')) {
    refs.add(value);
    return refs;
  }

  if (_.isArray(value)) {
    _.forEach(value, (item) => listRefs(item, refs));
    return refs;
  }

  if (_.isPlainObject(value)) {
    if (_.isString(value._ref) && _.startsWith(value._ref, '/_')) {
      refs.add(value._ref);
    }

    _.forEach(value, (item) => listRefs(item, refs));
  }

  return refs;
}

/**
 * Check a set of refs for existence and return only the missing refs.
 * @param {string} prefix
 * @param {string[]} refs
 * @param {string} key
 * @param {number} [concurrency=10]
 * @returns {Promise<string[]>}
 */
async function getMissingRefs(prefix, refs, key, concurrency = 10) {
  const limit = pLimit(concurrency),
    headers = authHeaders(key),
    checks = _.map(refs, (ref) => limit(async () => {
      const url = `${prefixes.uriToUrl(prefix, ref)}.json`,
        res = await rest.get(url, { headers }).toPromise(Promise);

      return { ref, missing: res instanceof Error };
    })),
    results = await Promise.all(checks);

  return _.map(_.filter(results, { missing: true }), 'ref');
}

/**
 * Prune or reset references that point to missing items.
 *
 * Rules:
 * - Missing ref strings in arrays are removed.
 * - Objects with missing `_ref` values are reset to `{}`.
 * - Every mutation is recorded in `changes`.
 *
 * @param {*} value
 * @param {Set<string>} missingSet
 * @param {object[]} changes
 * @param {string} [currentPath='$']
 * @returns {*}
 */
function pruneMissingRefs(value, missingSet, changes, currentPath = '$') {
  if (_.isArray(value)) {
    const next = [];

    _.forEach(value, (item, index) => {
      const itemPath = `${currentPath}[${index}]`;

      if (_.isString(item) && missingSet.has(item)) {
        changes.push({ action: 'remove-array-ref', path: itemPath, ref: item });
        return;
      }

      if (_.isPlainObject(item) && _.isString(item._ref) && missingSet.has(item._ref)) {
        changes.push({ action: 'remove-array-ref-object', path: itemPath, ref: item._ref });
        return;
      }

      next.push(pruneMissingRefs(item, missingSet, changes, itemPath));
    });

    return next;
  }

  if (_.isPlainObject(value)) {
    if (_.isString(value._ref) && missingSet.has(value._ref)) {
      changes.push({ action: 'reset-object-ref', path: currentPath, ref: value._ref });
      return {};
    }

    const out = {};

    _.forEach(value, (item, key) => {
      out[key] = pruneMissingRefs(item, missingSet, changes, `${currentPath}.${key}`);
    });

    return out;
  }

  return value;
}

/**
 * Recursively replace one ref with another (or reset to `{}`).
 * @param {*} value
 * @param {string} fromRef
 * @param {string} toRef
 * @param {object} [state]
 * @returns {*}
 */
function replaceRef(value, fromRef, toRef, state = {}) {
  const changes = state.changes || [],
    currentPath = state.currentPath || '$';

  if (_.isArray(value)) {
    return _.map(value, (item, index) => {
      const itemPath = `${currentPath}[${index}]`;

      if (_.isString(item) && item === fromRef) {
        changes.push({ action: 'replace-array-ref', path: itemPath, from: fromRef, to: toRef });
        return toRef;
      }

      return replaceRef(item, fromRef, toRef, { changes, currentPath: itemPath });
    });
  }

  if (_.isPlainObject(value)) {
    if (_.isString(value._ref) && value._ref === fromRef) {
      if (toRef === '{}') {
        changes.push({ action: 'reset-object-ref', path: currentPath, from: fromRef, to: '{}' });
        return {};
      }

      changes.push({ action: 'replace-object-ref', path: currentPath, from: fromRef, to: toRef });
      return _.assign({}, value, { _ref: toRef });
    }

    const out = {};

    _.forEach(value, (item, key) => {
      out[key] = replaceRef(item, fromRef, toRef, { changes, currentPath: `${currentPath}.${key}` });
    });

    return out;
  }

  return value;
}

/**
 * PUT the updated page payload to latest.
 * @param {string} pageUrl
 * @param {object} pageData
 * @param {string} key
 * @returns {Promise<object>}
 */
async function putPage(pageUrl, pageData, key) {
  const res = await rest.put(pageUrl, pageData, { key }).toPromise(Promise);

  if (res.type === 'error') {
    throw new Error(res.message || `Failed to update ${pageUrl}`);
  }

  return res;
}

/**
 * Publish a page after latest data has been updated.
 * @param {string} pageUrl
 * @param {string} key
 * @returns {Promise<object>}
 */
async function publishPage(pageUrl, key) {
  const res = await rest.put(`${pageUrl}@published`, undefined, { key }).toPromise(Promise);

  if (res.type === 'error') {
    throw new Error(res.message || `Failed to publish ${pageUrl}`);
  }

  return res;
}

/**
 * Find pages that include a given ref using the pages index.
 * @param {string} prefixOrAlias
 * @param {string} ref
 * @param {string} key
 * @param {number} [size=1000]
 * @returns {Promise<string[]>}
 */
async function whereUsed(prefixOrAlias, ref, key, size = 1000) {
  const prefix = getUrl(prefixOrAlias);

  if (!prefix) {
    throw new Error('URL is not defined! Please specify a site prefix to query');
  }

  const query = {
      index: 'pages',
      size: size,
      body: {
        query: {
          query_string: {
            query: `"${ref}"`
          }
        }
      }
    },
    res = await rest.query(`${prefix}/_search`, query, { key }).toPromise(Promise);

  if (res.type === 'error') {
    throw new Error(res.message || `Search failed for ${ref}`);
  }

  return _.map(
    _.filter(res.data, (item) => JSON.stringify(item).includes(ref)),
    (item) => item._id
  );
}

/**
 * Generate a timestamped snapshot file path in the current directory.
 * @param {string} pageUri
 * @returns {string}
 */
function defaultSnapshotPath(pageUri) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-'),
    fileName = `${pageUri.replace(/[\/@]/g, '_')}-${stamp}.clay`;

  return path.join(process.cwd(), fileName);
}

/**
 * Export a page (with layout dispatches) and write it to a snapshot file.
 * @param {string} rawUrl
 * @param {string} [outputPath]
 * @returns {Promise<object>}
 */
async function backupPage(rawUrl, outputPath) {
  const resolved = await resolvePage(rawUrl),
    dispatches = await exportCmd.fromURL(resolved.pageUrl, { layout: true }).toArray(Promise),
    filePath = outputPath || defaultSnapshotPath(resolved.pageUri),
    payload = _.map(dispatches, (dispatch) => JSON.stringify(dispatch)).join('\n');

  await fs.outputFile(filePath, payload);

  return {
    filePath,
    dispatchCount: dispatches.length,
    resolved
  };
}

/**
 * Restore a dispatch snapshot into a target site prefix.
 * @param {string} filePath
 * @param {string} targetUrl
 * @param {string} key
 * @param {boolean} publish
 * @returns {Promise<object>}
 */
async function restoreSnapshot(filePath, targetUrl, key, publish) {
  const input = await fs.readFile(filePath, 'utf8'),
    results = await importCmd(input, targetUrl, { key, publish }).toArray(Promise),
    successes = _.filter(results, { type: 'success' }).length,
    errors = _.filter(results, { type: 'error' });

  return { results, successes, errors };
}

module.exports.getKey = getKey;
module.exports.getUrl = getUrl;
module.exports.resolvePage = resolvePage;
module.exports.getPageData = getPageData;
module.exports.listRefs = listRefs;
module.exports.getMissingRefs = getMissingRefs;
module.exports.pruneMissingRefs = pruneMissingRefs;
module.exports.replaceRef = replaceRef;
module.exports.putPage = putPage;
module.exports.publishPage = publishPage;
module.exports.whereUsed = whereUsed;
module.exports.backupPage = backupPage;
module.exports.restoreSnapshot = restoreSnapshot;
module.exports.defaultSnapshotPath = defaultSnapshotPath;

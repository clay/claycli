'use strict';
const _ = require('lodash'),
  pLimit = require('p-limit'),
  fs = require('fs-extra'),
  h = require('highland'),
  path = require('path'),
  config = require('./config'),
  prefixes = require('../prefixes'),
  rest = require('../rest'),
  exportCmd = require('./export'),
  importCmd = require('./import');

function getKey(keyAlias) {
  return config.get('key', keyAlias);
}

function getUrl(urlAlias) {
  return config.get('url', urlAlias);
}

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

function authHeaders(key) {
  return key ? { Authorization: `Token ${key}` } : undefined;
}

async function getPageData(pageUrl, key) {
  const res = await rest.get(pageUrl, { headers: authHeaders(key) }).toPromise(Promise);

  if (res instanceof Error) {
    throw res;
  }

  return res;
}

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

async function putPage(pageUrl, pageData, key) {
  const res = await rest.put(pageUrl, pageData, { key }).toPromise(Promise);

  if (res.type === 'error') {
    throw new Error(res.message || `Failed to update ${pageUrl}`);
  }

  return res;
}

async function publishPage(pageUrl, key) {
  const res = await rest.put(`${pageUrl}@published`, undefined, { key }).toPromise(Promise);

  if (res.type === 'error') {
    throw new Error(res.message || `Failed to publish ${pageUrl}`);
  }

  return res;
}

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

function defaultSnapshotPath(pageUri) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-'),
    fileName = `${pageUri.replace(/[\/@]/g, '_')}-${stamp}.clay`;

  return path.join(process.cwd(), fileName);
}

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
module.exports.h = h;

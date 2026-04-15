'use strict';
const rest = require('../rest'),
  tools = require('./dev-tools');

async function prune(url, options = {}) {
  const key = tools.getKey(options.key),
    dryRun = options.apply !== true,
    resolved = await tools.resolvePage(url),
    pageData = await tools.getPageData(resolved.pageUrl, key),
    refs = [...tools.listRefs(pageData)],
    missingRefs = await tools.getMissingRefs(resolved.prefix, refs, key, options.concurrency || 10),
    changes = [],
    next = tools.pruneMissingRefs(pageData, new Set(missingRefs), changes);

  if (!dryRun && changes.length) {
    await tools.putPage(resolved.pageUrl, next, key);
    if (options.publish) {
      await tools.publishPage(resolved.pageUrl, key);
    }
  }

  return { action: 'prune', resolved, dryRun, missingRefs, changes, applied: !dryRun && changes.length > 0 };
}

async function replace(url, fromRef, toRef, options = {}) {
  const key = tools.getKey(options.key),
    dryRun = options.apply !== true,
    resolved = await tools.resolvePage(url),
    pageData = await tools.getPageData(resolved.pageUrl, key),
    changes = [],
    next = tools.replaceRef(pageData, fromRef, toRef, { changes });

  if (!dryRun && changes.length) {
    await tools.putPage(resolved.pageUrl, next, key);
    if (options.publish) {
      await tools.publishPage(resolved.pageUrl, key);
    }
  }

  return { action: 'replace', resolved, dryRun, fromRef, toRef, changes, applied: !dryRun && changes.length > 0 };
}

async function reset(ref, prefixOrAlias, options = {}) {
  const key = tools.getKey(options.key),
    prefix = tools.getUrl(prefixOrAlias),
    refUrl = `${prefix}${ref}`,
    dryRun = options.apply !== true;

  if (!prefix) {
    throw new Error('URL is not defined! Please specify a site prefix to reset refs');
  }

  if (!dryRun) {
    const res = await rest.put(refUrl, {}, { key }).toPromise(Promise);

    if (res.type === 'error') {
      throw new Error(res.message || `Unable to reset ${ref}`);
    }
  }

  let pages = [];

  if (options.whereUsed) {
    pages = await tools.whereUsed(prefix, ref, key, options.size || 1000);
  }

  return { action: 'reset', dryRun, ref, refUrl, pages, applied: !dryRun };
}

async function whereUsed(prefixOrAlias, ref, options = {}) {
  const key = tools.getKey(options.key),
    pages = await tools.whereUsed(prefixOrAlias, ref, key, options.size || 1000);

  return { action: 'where-used', ref, pages };
}

module.exports.prune = prune;
module.exports.replace = replace;
module.exports.reset = reset;
module.exports.whereUsed = whereUsed;

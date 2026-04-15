'use strict';
const _ = require('lodash'),
  lint = require('./lint'),
  tools = require('./dev-tools');

async function diagnose(url, options = {}) {
  const key = tools.getKey(options.key),
    resolved = await tools.resolvePage(url),
    lintResults = await lint.lintUrl(resolved.pageUrl, { concurrency: options.concurrency }).toArray(Promise),
    lintErrors = _.uniq(_.map(_.filter(lintResults, { type: 'error' }), 'message')),
    pageData = await tools.getPageData(resolved.pageUrl, key),
    refs = [...tools.listRefs(pageData)],
    missingRefs = await tools.getMissingRefs(resolved.prefix, refs, key, options.concurrency || 10);

  return {
    resolved,
    lintErrors,
    refsCount: refs.length,
    missingRefs
  };
}

async function safeFix(url, options = {}) {
  const key = tools.getKey(options.key),
    dryRun = options.apply !== true,
    resolved = await tools.resolvePage(url),
    pageData = await tools.getPageData(resolved.pageUrl, key),
    refs = [...tools.listRefs(pageData)],
    missingRefs = await tools.getMissingRefs(resolved.prefix, refs, key, options.concurrency || 10),
    missingSet = new Set(missingRefs),
    changes = [],
    next = tools.pruneMissingRefs(pageData, missingSet, changes);

  if (!dryRun && changes.length) {
    await tools.putPage(resolved.pageUrl, next, key);

    if (options.publish) {
      await tools.publishPage(resolved.pageUrl, key);
    }
  }

  return {
    resolved,
    dryRun,
    missingRefs,
    changes,
    applied: !dryRun && changes.length > 0
  };
}

module.exports.diagnose = diagnose;
module.exports.safeFix = safeFix;

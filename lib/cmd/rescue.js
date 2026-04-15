'use strict';
const doctor = require('./doctor'),
  tools = require('./dev-tools');

/**
 * Run full rescue workflow:
 * 1) backup page
 * 2) diagnose
 * 3) safe-fix (dry-run by default)
 *
 * @param {string} url
 * @param {object} [options={}]
 * @returns {Promise<object>}
 */
async function run(url, options = {}) {
  const backup = await tools.backupPage(url, options.output),
    diagnosis = await doctor.diagnose(url, options),
    fixResult = await doctor.safeFix(url, {
      key: options.key,
      apply: options.apply,
      publish: options.publish,
      concurrency: options.concurrency
    });

  return {
    backup,
    diagnosis,
    fixResult
  };
}

module.exports.run = run;

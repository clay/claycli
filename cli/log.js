'use strict';

const _ = require('lodash');
const clayLog = require('clay-log');
const pkg = require('../package.json');

let instance = null;

/**
 * Initialize the logger.
 *
 * @param {Object|Function} [customLogger]
 * @return {Function}
 */
function init(customLogger) {
  if (!instance) {
    clayLog
      .init({
        name: 'claycli',
        prettyPrint: true,
        meta: {
          clayCLIVersion: pkg.version
        }
      });

    instance = clayLog.getLogger();
    return instance;
  }

  if (customLogger) {
    instance = customLogger;
    return instance;
  }

  return instance;
}

/**
 * Set up new logger.
 *
 * @param {Object|Function} meta
 * @returns {Function}
 */
function setup(meta = {}) {
  const logger = init();

  return clayLog.meta(meta, logger);
}


/**
 * Override the logger instance.
 *
 * @param {Object|Function} replacement
 */
function setLogger(replacement) {
  instance = replacement;
}

init();

module.exports = init;
module.exports.getLogger = init;
module.exports.setup = setup;
module.exports.setLogger = setLogger;

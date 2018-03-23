'use strict';
const _ = require('lodash'),
  clayLog = require('clay-log'),
  pkg = require('../../package.json');

let logger;

clayLog.init({
  name: 'claycli',
  output: process.stderr,
  meta: { claycliVersion: pkg.version }
});

logger = clayLog.meta({ file: __filename });

/**
 * log simple messages
 * @param  {string} message
 */
function log(message) {
  logger('info', message);
}

/**
 * log each operation as it happens
 * @param  {object} action
 */
function logAction(action) {
  if (action.action === 'warning') {
    logger('warn', action.message, action);
  } else if (action.action === 'error') {
    logger('error', action.message, action);
  } else {
    logger('info', action.message, action);
  }
}

/**
 * log a summary at the end of the command, giving a list of errors and warnings
 * @param  {function} summary that returns { success, message }
 * @param  {array} results
 */
function logSummary(summary, results) {
  const successes = _.filter(results, { action: 'success' }),
    errors = _.filter(results, { action: 'error' }),
    sum = summary(successes.length, errors.length);

  if (sum.success) {
    logger('info', sum.message);
  } else {
    logger('error', sum.message);
  }
}

module.exports.log = log;
module.exports.logAction = logAction;
module.exports.logSummary = logSummary;

'use strict';
const chalk = require('chalk'),
  _ = require('lodash'),
  term = require('terminal-logger')('pretty');

term.level = 'debug'; // log everything

/**
 * log simple messages
 * @param  {string} message
 */
function log(message) {
  term.status.info(message);
}

/**
 * log each operation as it happens
 * @param  {object} action
 */
function logAction(action) {
  let details = action.details && _.isString(action.details) ? ` ${chalk.grey('(' + action.details + ')')}` : '',
    message = `${action.message}${details}`;

  if (_.has(term.status, action.type)) {
    term.status[action.type](message);
  } else if (action.type === 'success') {
    term.status.ok(message);
  } else {
    term.status.info(`${chalk.blue(action.type)} - ${message}`);
  }
}

/**
 * log a summary at the end of the command, giving a list of errors and warnings
 * @param  {function} summary that returns { success, message }
 * @param  {array} results
 */
function logSummary(summary, results) {
  const successes = _.filter(results, { type: 'success' }),
    errors = _.filter(results, { type: 'error' }),
    sum = summary(successes.length, errors.length);

  process.stderr.write('\n'); // log BELOW the dots
  if (sum.success) {
    term.tick(sum.message);
  } else {
    term.cross(sum.message);
  }
}

module.exports.log = log;
module.exports.logAction = logAction;
module.exports.logSummary = logSummary;

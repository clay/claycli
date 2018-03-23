'use strict';
const chalk = require('chalk'),
  _ = require('lodash'),
  term = require('terminal-logger')('dots');

term.level = 'debug'; // log everything
chalk.enabled = true;
chalk.level = 1;

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
  if (action.type === 'success') {
    process.stderr.write(chalk.green('.'));
  } else if (action.type === 'error') {
    process.stderr.write(chalk.red('.'));
  }
}

/**
 * log a summary at the end of the command, giving a list of errors and warnings
 * @param  {function} summary that returns { success, message }
 * @param  {array} results
 */
function logSummary(summary, results) {
  const successes = _.filter(results, { type: 'success' }),
    warnings = _.filter(results, { type: 'warning' }),
    errors = _.filter(results, { type: 'error' }),
    sum = summary(successes.length, errors.length);

  process.stderr.write('\n'); // log BELOW the dots
  if (sum.success) {
    term.tick(sum.message);
  } else {
    term.cross(sum.message);
  }

  // more details
  if (errors.length) {
    process.stderr.write('\n');
  }
  _.each(errors, (error) => {
    if (error.details && _.isString(error.details)) {
      term.status.error(`${error.message} ${chalk.grey('(' + error.details + ')')}`);
    } else {
      term.status.error(error.message);
    }
  });

  if (warnings.length) {
    process.stderr.write('\n');
  }
  _.each(warnings, (warning) => {
    if (warning.details && _.isString(warning.details)) {
      term.status.warning(`${warning.message} ${chalk.grey('(' + warning.details + ')')}`);
    } else {
      term.status.warning(warning.message);
    }
  });
}

module.exports.log = log;
module.exports.logAction = logAction;
module.exports.logSummary = logSummary;

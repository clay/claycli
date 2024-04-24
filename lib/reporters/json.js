import * as _ from 'lodash';
import * as clayLog from 'clay-log';
import * as pkg from '../../package.json';

let logger = clayLog.init({
  name: 'claycli',
  output: process.stderr,
  meta: { claycliVersion: pkg.version }
});

/**
 * log simple messages
 * @param  {string} message
 * @param  {string} command
 */
export function log(message, command) {
  logger('info', message, { command, type: 'info' });
}

/**
 * log each operation as it happens
 * @param  {object} action
 * @param  {string} command
 */
export function logAction(action, command) {
  const message = action.message;

  delete action.message; // remove duplicate property
  action.command = command; // add command
  if (action.type === 'warning') {
    logger('warn', message, action);
  } else if (action.type === 'error') {
    logger('error', message, action);
  } else {
    logger('info', message, action);
  }
}

/**
 * log a summary at the end of the command, giving a list of errors and warnings
 * @param  {function} summary that returns { success, message }
 * @param  {array} results
 * @param  {string} command
 */
export function logSummary(summary, results, command) {
  const successes = _.filter(results, { type: 'success' }),
    errors = _.filter(results, { type: 'error' }),
    sum = summary(successes.length, errors.length);

  if (sum.success) {
    logger('info', sum.message, { command, type: 'info' });
  } else {
    logger('error', sum.message, { command, type: 'info' });
  }
}

import _ from 'lodash';

const clayLog = require('clay-log');
const pkg = require('../../package.json');

interface Action {
  type: string;
  message?: string;
  command?: string;
  details?: string;
  [key: string]: unknown;
}

interface Summary {
  success: boolean;
  message: string;
}

const logger = clayLog.init({
  name: 'claycli',
  output: process.stderr,
  meta: { claycliVersion: pkg.version }
});

/**
 * log simple messages
 */
function log(message: string, command: string): void {
  logger('info', message, { command, type: 'info' });
}

/**
 * log each operation as it happens
 */
function logAction(action: Action, command: string): void {
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
 */
function logSummary(
  summary: (successes: number, errors: number) => Summary,
  results: Action[],
  command: string
): void {
  const successes = _.filter(results, { type: 'success' }),
    errors = _.filter(results, { type: 'error' }),
    sum = summary(successes.length, errors.length);

  if (sum.success) {
    logger('info', sum.message, { command, type: 'info' });
  } else {
    logger('error', sum.message, { command, type: 'info' });
  }
}

export { log, logAction, logSummary };

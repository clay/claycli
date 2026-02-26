import _ from 'lodash';

const chalk = require('chalk');
const term = require('terminal-logger')('pretty');

term.level = 'debug'; // log everything

interface Action {
  type: string;
  message: string;
  details?: string;
}

interface Summary {
  success: boolean;
  message: string;
}

/**
 * log simple messages
 */
function log(message: string): void {
  term.status.info(message);
}

/**
 * log each operation as it happens
 */
function logAction(action: Action): void {
  const details = action.details && _.isString(action.details) ? ` ${chalk.grey('(' + action.details + ')')}` : '',
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
 */
function logSummary(
  summary: (successes: number, errors: number) => Summary,
  results: Action[]
): void {
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

export { log, logAction, logSummary };

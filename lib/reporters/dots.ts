import _ from 'lodash';

const chalk = require('chalk');
const term = require('terminal-logger')('dots');

term.level = 'debug'; // log everything
chalk.enabled = true;
chalk.level = 1;

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
  if (action.type === 'success') {
    process.stderr.write(chalk.green('.'));
  } else if (action.type === 'error') {
    process.stderr.write(chalk.red('.'));
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

export { log, logAction, logSummary };

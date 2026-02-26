import _ from 'lodash';

const chalk = require('chalk');
const NyanCat = require('nyansole');
const term = require('terminal-logger')('nyan');

interface Action {
  type: string;
  action?: string;
  message: string;
  details?: string;
}

interface Summary {
  success: boolean;
  message: string;
}

let cat: InstanceType<typeof NyanCat> | undefined;

/**
 * log simple messages and reset the cat
 */
function log(message: string): void {
  term.status.info(message);

  if (!cat) {
    cat = new NyanCat();
    cat.reset();
    cat.start();
  }
}

/**
 * move the cat!
 */
function logAction(action: Action): void {
  if (!cat) {
    cat = new NyanCat();
    cat.reset();
    cat.start();
  }

  if (action.action === 'failure') {
    cat.stop();
  }
}

/**
 * log a summary at the end of the command, giving a list of errors and warnings
 */
function logSummary(
  summary: (successes: number, errors: number) => Summary,
  results: Action[]
): void {
  const successes = _.filter(results, { action: 'success' }),
    warnings = _.filter(results, { action: 'warning' }),
    errors = _.filter(results, { action: 'error' }),
    sum = summary(successes.length, errors.length);

  if (!cat) {
    cat = new NyanCat();
    cat.reset();
    cat.start();
  }
  cat.end();
  process.stderr.write('\n'); // add extra line
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

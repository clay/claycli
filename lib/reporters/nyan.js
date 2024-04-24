import * as chalk from 'chalk';
import * as _ from 'lodash';
import * as termConfig from 'terminal-logger';
import * as NyanCat from 'nyansole';

const term = termConfig('nyan');

let cat;

/**
 * log simple messages and reset the cat
 * @param  {string} message
 */
export function log(message) {
  term.status.info(message);

  if (!cat) {
    cat = new NyanCat();
    cat.reset();
    cat.start();
  }
}

/**
 * move the cat!
 * @param  {object} action
 */
export function logAction(action) {
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
 * @param  {function} summary that returns { success, message }
 * @param  {array} results
 */
export function logSummary(summary, results) {
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

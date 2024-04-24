import * as _ from 'lodash';
import * as dots from './dots.js';
import * as pretty from './pretty.js';
import * as json from './json.js';
import * as nyan from './nyan.js';

const reporters = { dots, pretty, json, nyan };

/**
 * reporter is passed in via argument, or env variable, or defaults to 'dots'
 * @param  {string} [reporter] from argv.reporter
 * @return {string}
 */
function getReporter(reporter) {
  return reporter || process.env.CLAYCLI_REPORTER || 'dots';
}

/**
 * simple log passthrough
 * @param  {string} reporter
 * @param  {string} command e.g. 'lint'
 * @return  {function}
 */
export function log(reporter, command) {
  reporter = getReporter(reporter);

  return (message) => {
    if (_.has(reporters, `${reporter}.log`)) {
      reporters[reporter].log(message, command);
    }
  };
}

/**
 * log individual actions
 * @param  {string} [reporter] from argv.reporter
 * @param  {string} command e.g. lint
 * @return {function} that each action is passed into
 */
export function logAction(reporter, command) {
  reporter = getReporter(reporter);

  return (action) => {
    // only log actions, not data
    if (_.isObject(action) && _.has(action, 'type') && _.has(reporters, `${reporter}.logAction`)) {
      reporters[reporter].logAction(action, command);
    }
    return action; // pass it on
  };
}

/**
 * log summary of results
 * @param  {string} [reporter] from argv.reporter
 * @param  {string} command e.g. 'lint'
 * @param  {function} summary function that returns { success: boolean, message: string }
 * @return {function} that array of results is passed into
 */
export function logSummary(reporter, command, summary) {
  reporter = getReporter(reporter);

  return (results) => {
    if (_.has(reporters, `${reporter}.logSummary`)) {
      reporters[reporter].logSummary(summary, results, command);
    }
  };
}

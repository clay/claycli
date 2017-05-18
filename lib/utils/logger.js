const davlog = require('davlog'),
  _ = require('lodash'),
  ora = require('ora'),
  logger = davlog.init({
    name: 'clay'
  }),
  spinners = {};

// use logger.log as the debug level
logger.STRINGS.log = 'debug';
// fatal errors exit the application
logger.STRINGS.error = 'fatal';
// regular errors don't exit the application
logger.STRINGS.err = 'error';

let logLevel = 'INFO'; // default log level

/**
 * set log level based on verbosity
 * @param {Boolean} isVerbose true if -V, --verbose
 */
function setLogLevel(isVerbose) {
  if (isVerbose) {
    logLevel = 'DEBUG';
  } else {
    logLevel = 'INFO';
  }
}

/**
 * only log debug messages in verbose mode
 * @param  {string} message
 */
function logDebug(message) {
  if (logLevel === 'DEBUG') {
    logger.log(message);
  }
}

/**
 * start a spinner
 * @param  {string} text
 * @returns {object}
 */
function startSpinner(text) {
  spinners[text] = ora({
    text,
    color: 'magenta'
  }).start();
  return spinners[text];
}

/**
 * stop a spinner
 * @param  {string|object} spinner
 */
function stopSpinner(spinner) {
  if (_.isString(spinner) && spinners[spinner]) {
    // reference spinner via text
    spinners[spinner].stop();
  } else if (_.isObject(spinner) && _.isFunction(spinner.stop)) {
    // passed in spinner directly
    spinner.stop();
  } else {
    throw new Error(`No spinner for "${spinner}"`);
  }
}

module.exports = {
  setLogLevel,
  debug: logDebug,
  log: logger.info,
  startSpinner,
  stopSpinner,
  warn: logger.warn,
  error: logger.err,
  fatal: logger.error
};

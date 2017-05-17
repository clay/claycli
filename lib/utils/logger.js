const davlog = require('davlog'),
  logger = davlog.init({
    name: 'clay'
  });

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

module.exports = {
  setLogLevel,
  debug: logDebug,
  log: logger.info,
  warn: logger.warn,
  error: logger.err,
  fatal: logger.error
};

const consoleLog = require('console-log-level'),
  _ = require('lodash'),
  ora = require('ora'),
  figures = require('figures'),
  chalk = require('chalk'),
  spinners = {},
  prefixes = {
    debug: chalk.dim(chalk.magenta('[DEBUG]')),
    info: chalk.blue('[INFO]'),
    success: chalk.green(` ${figures.tick} `),
    warn: chalk.yellow('[WARNING]'),
    error: chalk.red('[ERROR]')
  };

let logger;

function setLogLevel(isVerbose) {
  if (isVerbose) {
    logger = consoleLog({ level: 'debug' });
  } else {
    logger = consoleLog({ level: 'info' });
  }
}

function log(level) {
  return (message, moreInfo) => {
    const method = level === 'success' ? 'info' : level;

    let fullMessage = `${prefixes[level]} ${message}`;

    if (!logger) {
      throw new Error('Please call logger.init() to initialize a logger!');
    }

    if (moreInfo) {
      fullMessage += ` ${chalk.dim(moreInfo)}`;
    }

    logger[method](fullMessage);
  };
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
  init: setLogLevel,
  debug: log('debug'),
  info: log('info'),
  success: log('success'),
  startSpinner,
  stopSpinner,
  warn: log('warn'),
  error: log('error')
};

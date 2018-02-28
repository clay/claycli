'use strict';
const _ = require('lodash'),
  clayLog = require('clay-log'),
  pkg = require('../package.json');

// note: clay-log is for log messages that don't appear in the normal course of using claycli
// e.g. errors, debugging, programmatic warnings, etc
// for the logger we use when running cli commands, please see ./terminal-logger.js
clayLog.init({
  name: 'claycli',
  output: process.stderr,
  pretty: true,
  meta: { claycliVersion: pkg.version }
});

/**
 * log debug messages
 * @param  {function} logger
 * @returns {function}
 */
function debug(logger) {
  return (message, logObj) => logger('debug', message, logObj);
}

/**
 * log warning messages
 * @param  {function} logger
 * @returns {function}
 */
function warn(logger) {
  return (message, logObj) => logger('warn', message, logObj);
}

/**
 * log error messages
 * note: you can simply pass in an Error and it will print nicely
 * @param  {function} logger
 * @returns {function}
 */
function error(logger) {
  return (message, logObj) => {
    if (_.isString(message)) {
      logger('error', message, logObj);
    } else {
      logger('error', message); // pass in error object directly
    }
  };
}

/**
 * instantiate a logger for each file
 * @param  {string|object} [filename] or file-specific log metadata
 * @return {object}
 */
module.exports = (filename) => {
  let logger;

  if (_.isString(filename)) {
    logger = clayLog.meta({ file: filename });
  } else if (_.isObject(filename)) {
    logger = clayLog.meta(filename);
  } else {
    logger = clayLog.meta({}); // empty object for file-specific meta, maintains the syntax for other logs
  }

  return {
    debug: debug(logger),
    warn: warn(logger),
    error: error(logger)
  };
};

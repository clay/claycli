'use strict';

// note: this logger is used to print nicely-formatted messages when using cli commands.
// for non-human-centric logging of errors, debugs, and warnings, please see ./logger.js
const terminalLogger = require('terminal-logger'),
  ora = require('ora');

module.exports = (name) => {
  let logger = terminalLogger(name);

  logger.spinner = ora;
  return logger;
};

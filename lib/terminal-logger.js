'use strict';

// note: this logger is used to print nicely-formatted messages when using cli commands.
// for non-human-centric logging of errors, debugs, and warnings, please see ./logger.js
const terminalLogger = require('terminal-logger');

module.exports = (name) => {
  return terminalLogger(name);
};

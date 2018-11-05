'use strict';

const amphoraFs = require('amphora-fs'),
  CONFIG_FILENAME = 'claycli.config';
var CONFIG_FILE = getConfigFile();

/**
 * Grab the config file from the working directory
 * or return undefined
 *
 * @returns {Object|Undefined}
 */
function getConfigFile() {
  return amphoraFs.tryRequire(`${process.cwd()}/${CONFIG_FILENAME}`);
}

/**
 * Return a value from the config file
 *
 * @param {String} key
 * @returns {Any}
 */
function getConfigValue(key) {
  if (!CONFIG_FILE) {
    return undefined;
  }

  return CONFIG_FILE[key];
}

module.exports.getConfigValue = getConfigValue;

// For testing
module.exports.getConfigFile = getConfigFile;
module.exports.setConfigFile = val => CONFIG_FILE = val;

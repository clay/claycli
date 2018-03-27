'use strict';
const config = require('home-config'),
  _ = require('lodash'),
  configName = '.clayconfig';

// note: all of the methods this exports are synchronous

/**
 * clean urls that are coming from config, CLAYCLI_DEFAULT_URL, or passed through
 * @param  {string} url
 * @return {string}
 */
function sanitizeUrl(url) {
  // assume http if they haven't specified https
  if (url && !_.includes(url, 'https://')) {
    url = `http://${url.replace(/^(?:http:\/\/|\/\/)/i, '')}`;
  }

  // sanitize trailing slash
  if (url) {
    url = url.replace(/\/$/, '');
  }

  return url;
}

/**
 * get value from config
 * @param  {string} type
 * @param  {string} alias
 * @return {string}
 */
function getConfig(type, alias) {
  const fullConfig = config.load(configName);

  switch (type) {
    case 'key': return _.get(fullConfig, `keys[${alias}]`) || process.env.CLAYCLI_DEFAULT_KEY || alias; // allow passing through actual keys
    case 'url': return sanitizeUrl(_.get(fullConfig, `urls[${alias}]`) || process.env.CLAYCLI_DEFAULT_URL || alias); // sanitize url if we're actually passing it through
    default: throw new Error(`Unknown config section "${type}"`);
  }
}

/**
 * get all config options
 * @return {object}
 */
function getAll() {
  return config.load(configName);
}

/**
 * set value in config
 * @param  {string} type
 * @param  {string} alias
 * @param {string} value
 */
function setConfig(type, alias, value) {
  const fullConfig = config.load(configName);

  switch (type) {
    case 'key': _.set(fullConfig, `keys[${alias}]`, value) && fullConfig.save();
      break;
    case 'url': _.set(fullConfig, `urls[${alias}]`, value) && fullConfig.save();
      break;
    default: throw new Error(`Unknown config section "${type}"`);
  }
}

module.exports.get = getConfig;
module.exports.getAll = getAll;
module.exports.set = setConfig;

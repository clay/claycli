const config = require('home-config'),
  _ = require('lodash'),
  configName = '.clayconfig';

/**
 * get value from .clayconfig
 * @param  {string} alias e.g. key.local or site.prod
 * @return {string|null}
 */
function getConfig(alias) {
  const fullConfig = config.load(configName),
    value = _.get(fullConfig, alias),
    type = alias.split('.')[0];

  if (!value && !_.includes(['keys', 'sites'], type)) {
    throw new Error(`Cannot get ${alias}: Unknown section "${type}"`);
  } else if (!value) {
    return null;
  } else {
    return value;
  }
}

/**
 * set value in .clayconfig
 * @param {string} alias e.g. key.local or site.prod
 * @param {string} value
 */
function setConfig(alias, value) {
  const type = alias.split('.')[0],
    fullConfig = config.load(configName);

  if (!_.includes(['keys', 'sites'], type)) {
    throw new Error(`Cannot save ${alias}: Unknown section "${type}"`);
  }

  _.set(fullConfig, alias, value);
  fullConfig.save();
}

/**
 * get key from config or env variable
 * note: assumes you're passing in a key if the config doesn't have your alias
 * @param  {string} keyname alias or full key
 * @return {string|null}
 */
function getKey(keyname) {
  if (keyname) {
    return getConfig(`keys.${keyname}`) || keyname;
  } else {
    return process.env.CLAY_DEFAULT_KEY || null;
  }
}

/**
 * normalize site prefix
 * allows users to use site configs without needing protocol,
 * and fixes trailing slashes
 * @param  {string} url
 * @return {string}
 */
function normalizeSite(url) {
  // normalize protocol
  if (!_.includes(url, 'https://')) {
    url = `http://${url.replace(/^(?:http:\/\/|\/\/)/i, '')}`;
  }

  // normalize trailing slash
  url = url.replace(/\/$/, '');

  return url;
}

/**
 * get site from config or env variable
 * note: assumes you're passing in a url to normalize if the config doesn't have your alias
 * @param  {string} sitename alias or full site prefix
 * @return {string|null}
 */
function getSite(sitename) {
  if (sitename) {
    let url = getConfig(`sites.${sitename}`);

    return url ? normalizeSite(url) : normalizeSite(sitename);
  } else {
    return process.env.CLAY_DEFAULT_SITE ? normalizeSite(process.env.CLAY_DEFAULT_SITE) : null;
  }
}

module.exports.get = getConfig;
module.exports.set = setConfig;
module.exports.getKey = getKey;
module.exports.getSite = getSite;

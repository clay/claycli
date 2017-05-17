const config = require('home-config'),
  _ = require('lodash'),
  configName = '.clayconfig';

/**
 * get value from .clayconfig
 * @param  {string} alias e.g. key.local or site.prod
 * @return {string}
 */
module.exports.get = (alias) => {
  const fullConfig = config.load(configName),
    value = _.get(fullConfig, alias),
    type = alias.split('.')[0];

  if (!value && !_.includes(['key', 'site'], type)) {
    throw new Error(`Cannot get ${alias}: Unknown section "${type}"`);
  } else if (!value) {
    return null;
  } else {
    return value;
  }
};

/**
 * set value in .clayconfig
 * @param {string} alias e.g. key.local or site.prod
 * @param {string} value
 */
module.exports.set = (alias, value) => {
  const type = alias.split('.')[0],
    fullConfig = config.load(configName);

  if (!_.includes(['key', 'site'], type)) {
    throw new Error(`Cannot save ${alias}: Unknown section "${type}"`);
  }

  _.set(fullConfig, alias, value);
  fullConfig.save();
};

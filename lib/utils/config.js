const config = require('home-config'),
  _ = require('lodash'),
  configName = '.clayconfig';

module.exports.get = (alias) => {
  const fullConfig = config.load(configName),
    value = _.get(fullConfig, alias),
    type = alias.split('.')[0];

  if (!value && !_.includes(['key', 'site'], type)) {
    throw new Error(`Cannot get ${alias}: Unknown section "${type}"`);
  } else if (!value) {
    throw new Error(`No value defined for "${alias}"`);
  } else {
    return value;
  }
};

module.exports.set = (alias, value) => {
  const type = alias.split('.')[0],
    fullConfig = config.load(configName);

  if (!_.includes(['key', 'site'], type)) {
    throw new Error(`Cannot set ${alias}: Unknown section "${type}"`);
  }

  _.set(fullConfig, alias, value);
  fullConfig.save();
};

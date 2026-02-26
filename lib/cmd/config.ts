import _ from 'lodash';

const config = require('home-config');
const configName = '.clayconfig';

// note: all of the methods this exports are synchronous

/**
 * clean urls that are coming from config, CLAYCLI_DEFAULT_URL, or passed through
 */
function sanitizeUrl(url: string): string {
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
 */
function getConfig(type: string, alias?: string): string {
  const fullConfig = config.load(configName);

  switch (type) {
    case 'key': return _.get(fullConfig, `keys[${alias}]`) || alias || process.env.CLAYCLI_DEFAULT_KEY; // allow passing through actual keys
    case 'url': return sanitizeUrl(_.get(fullConfig, `urls[${alias}]`) || alias || process.env.CLAYCLI_DEFAULT_URL); // sanitize url if we're actually passing it through
    default: throw new Error(`Unknown config section "${type}"`);
  }
}

/**
 * get all config options
 */
function getAll(): Record<string, unknown> {
  return config.load(configName);
}

/**
 * set value in config
 */
function setConfig(type: string, alias: string, value: string): void {
  const fullConfig = config.load(configName);

  switch (type) {
    case 'key': _.set(fullConfig, `keys[${alias}]`, value) && fullConfig.save();
      break;
    case 'url': _.set(fullConfig, `urls[${alias}]`, value) && fullConfig.save();
      break;
    default: throw new Error(`Unknown config section "${type}"`);
  }
}

export {
  getConfig as get,
  getAll,
  setConfig as set
};

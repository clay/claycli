const amphoraFs = require('amphora-fs');

const CONFIG_FILENAME = 'claycli.config';

type ConfigFile = Record<string, unknown> | undefined;

let CONFIG_FILE: ConfigFile = getConfigFile();

/**
 * Grab the config file from the working directory
 * or return undefined
 */
function getConfigFile(): ConfigFile {
  return amphoraFs.tryRequire(`${process.cwd()}/${CONFIG_FILENAME}`);
}

/**
 * Return a value from the config file
 */
function getConfigValue(key: string): unknown {
  if (!CONFIG_FILE) {
    return undefined;
  }

  return CONFIG_FILE[key];
}

export { getConfigValue, getConfigFile };

// For testing
export const setConfigFile = (val: ConfigFile): ConfigFile => CONFIG_FILE = val;

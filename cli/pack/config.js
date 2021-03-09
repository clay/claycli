'use strict';

const { getConfigValue } = require('../../lib/config-file-helpers'),
  Config = require('webpack-chain');

/**
 * Given a stateful webpack-chain configuration object, set sensible defaults
 * for a development environment.
 *
 * @param {Config} config - The webpack-chain configuration object.
 * @returns {Config} - The modified configuration object.
 */
function buildDevelopmentDefaults(config) {
}


/**
 * Given a stateful webpack-chain configuration object, set defaults which apply
 * to both production and development environments.
 *
 * @param {Config} config - The webpack-chain configuration object.
 * @returns {Config} - The modified configuration object.
 */
function buildGlobalDefaults(config) {
}

/**
 * Given a stateful webpack-chain configuration object, set sensible defaults
 * for a production environment.
 *
 * @param {Config} config - The webpack-chain configuration object.
 * @returns {Config} - The modified configuration object.
 */
function buildProductionDefaults(config) {
}

/**
 * If the package consuming Clay CLI sets a customizer function in
 * `claycli.config.js`, pass it the stateful configuration object. If not,
 * return the config object unmodified.
 *
 * @param {Config} config - The webpack-chain configuration object.
 * @returns {Config} - The modified configuration object.
 * @throws {Error} - If the returns an invalid config object.
 */
function customizeConfig(config) {
  const customizer = getConfigValue('packConfig');

  if (!customizer) {
    return config;
  }

  const customConfig = customizer(config);

  // `toConfig` is always defined on a webpack-chain configuration. A
  // non-webpack-chain object with a `toConfig` method could still fool us, but
  // that's not really our problem.
  if (
    typeof customConfig !== 'object' ||
    typeof customConfig.toConfig !== 'function'
  ) {
    throw new Error(`Expected packConfig to return a webpack-chain configuration. Got ${ typeof customConfig }.`);
  }

  return customConfig;
}

/**
 * Generate a webpack-chain configuration object. Its settings will vary
 * depending on the current Node environment and the `claycli.config.js` file in
 * the consumer repo.
 *
 * @returns {Config} - The webpack-chain configuration object.
 */
function getPackConfig() {
  let config = new Config();

  config = buildGlobalDefaults(config);

  switch (process.env.NODE_ENV) {
    case 'production':
      config = buildProductionDefaults(config);
    case 'development':
    default:
      config = buildDevelopmentDefaults(config);
  }

  return customizeConfig(config);
}

module.exports = getPackConfig;

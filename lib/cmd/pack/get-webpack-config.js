'use strict';

const AssetManifestPlugin = require('webpack-assets-manifest');
const CaseSensitivePathsPlugin = require('case-sensitive-paths-webpack-plugin');
const Config = require('webpack-chain');
const { getConfigValue } = require('../../config-file-helpers');
const { sync: globSync } = require('glob');
const path = require('path');

/**
 * Given a stateful webpack-chain configuration object, set sensible defaults
 * for a development environment.
 *
 * @param {Config} config - The webpack-chain configuration object.
 * @returns {Config} - The modified configuration object.
 */
function buildDevelopmentDefaults(config) {
  return config;
}


/**
 * Given a stateful webpack-chain configuration object, set defaults which apply
 * to both production and development environments.
 *
 * @param {Config} config - The webpack-chain configuration object.
 * @returns {Config} - The modified configuration object.
 */
function buildGlobalDefaults(config) {
  // It's easier to read configuration chains with some extra indentation.
  /* eslint-disable indent */

  // Core build configuration.
  config
    .devtool('source-map')
    .name('clay-pack')
    .target('web'); // TODO: Support serverside builds with target "node".

  // A mapping of pathnames to entrypoints. For now, we're assuming all the code
  // we care about lives under the `components` module in the working directory
  // and matches the filename `client.pack.js`.
  const entry = getEntries('./components', 'client.pack.js');

  config
    .context(process.cwd())
    .merge({
      entry: entry
    });


  // Build output parameters.
  config.output
    .chunkFilename('scripts/[id].[contenthash].js')
    .crossOriginLoading('anonymous')
    .filename('scripts/[name].[contenthash].js')
    .path(path.join(process.cwd(), './public'))
    .publicPath('/');

  // Ensure `import` and `require` statements are case-sensitive, even on
  // platforms (like macOS) which are not.
  config
    .plugin('case-sensitive-paths')
      .use(CaseSensitivePathsPlugin);

  // Generate an asset manifest mapping source files to built assets. We ensure
  // the manifest includes all entrypoints, each of which is a complete
  // dependency chain for the source file.
  config
    .plugin('asset-manifest')
      .use(AssetManifestPlugin, [
        {
          entrypoints: true,
        }
      ]);
  /* eslint-enable indent */

  return config;
}

/**
 * Given a stateful webpack-chain configuration object, set sensible defaults
 * for a production environment.
 *
 * @param {Config} config - The webpack-chain configuration object.
 * @returns {Config} - The modified configuration object.
 */
function buildProductionDefaults(config) {
  config
    .mode('production');

  config.optimization
    .runtimeChunk('single')
    .splitChunks({
      chunks: 'all'
    });

  return config;
}

/**
 * If the package consuming Clay CLI sets a customizer function in
 * `claycli.config.js`, pass it the stateful configuration object. If not,
 * return the config object unmodified.
 *
 * @param {Config} config - The webpack-chain configuration object.
 * @returns {Config} - The modified configuration object.
 * @throws {Error} - If the customizer returns an invalid config object.
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
 * Return an object which maps source component paths to script files. This
 * becomes Webpack's `entrypoint` setting. By including each component as its
 * own entrypoint, we guarantee all of its dependencies are enumerated in our
 * asset manifest. They'll be deduped on page load.
 *
 * @param {string} componentPath - Relative path to the `components` directory.
 * @param {string} filename - Name of the target source files.
 * @returns {Object} - A mapping of Webpack entrypoints.
 */
function getEntries(componentPath, filename) {
  const glob = path.join(componentPath, '**', filename);
  return globSync(glob).reduce((entries, pathname) => {
    const namespace = path.relative(path.join(process.cwd(), componentPath), path.dirname(pathname));
    const assetPath = path.resolve(pathname);

    const previous = entries[namespace] || [];
    const next = previous.concat(assetPath);

    entries[namespace] = next;
    return entries;
  }, {});
}

/**
 * Generate a webpack-chain configuration object. Its settings will vary
 * depending on the current Node environment and the `claycli.config.js` file in
 * the consumer repo.
 *
 * @returns {Config} - The webpack-chain configuration object.
 */
function getWebpackConfig() {
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

module.exports = getWebpackConfig;

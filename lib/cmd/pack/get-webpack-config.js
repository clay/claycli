'use strict';

const { DefinePlugin, NormalModuleReplacementPlugin, ProgressPlugin } = require('webpack');
const AssetManifestPlugin = require('webpack-assets-manifest');
const CaseSensitivePathsPlugin = require('case-sensitive-paths-webpack-plugin');
const { CleanWebpackPlugin } = require('clean-webpack-plugin');
const { Plugin: CommonShakePlugin } = require('webpack-common-shake');
const Config = require('webpack-chain');
const cssImport = require('postcss-import');
const { getConfigValue } = require('../../config-file-helpers');
const { sync: globSync } = require('glob');
const mixins = require('postcss-mixins');
const nested = require('postcss-nested');
const path = require('path');
const simpleVars  = require('postcss-simple-vars');
const { VueLoaderPlugin } = require('vue-loader');

/**
  * Create a stateful webpack-chain configuration object and set sensible
 * defaults for a client-side build.
 *
 * @returns {Config} - A webpack-chain configuration object.
 */
function createClientConfig() {
  /* eslint-disable indent --- It's easier to read config chains with extra indentation. */

  const config = new Config();

  // Rewrite service modules that resolve to `server` so that they point to
  // `client`. There's no way around this without gut-renovating Sites, thanks
  // to {@link ../compile/scripts.js:103-123}.
  //
  // "And that's why... you don't write clever code."
  //    ---J. Walter Weatherman
  config
    .plugin('server-module-replacement')
      .use(NormalModuleReplacementPlugin, [
        /server/,
        resource => {
          if (!resource.context.includes('services')) return;

          resource.request = resource.request.replace(/server/ig, 'client');
        }
      ]);

  config.merge({
    resolve: {
      fallback: {
        crypto: false,
        fs: false,
        path: false,
        vm: false
      }
    }
  });

  /* eslint-enable indent */

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
function buildCustomConfig(config) {
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
 * Given a stateful webpack-chain configuration object, set sensible defaults
 * for a development environment.
 *
 * @param {Config} config - The webpack-chain configuration object.
 * @returns {Config} - The modified configuration object.
 */
function buildDevelopmentConfig(config) {
  config.mode('development');

  return config;
}


/**
 * Given a stateful webpack-chain configuration object, set defaults which apply
 * to both production and development environments.
 *
 * @param {Config} config - The webpack-chain configuration object.
 * @returns {Config} - The modified configuration object.
 */
function buildGlobalConfig(config) {
  /* eslint-disable indent --- It's easier to read config chains with extra indentation. */

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
    .end();

  config.merge({
    entry: {
      ...entry,
      __clay_client_init: path.join(__dirname, '_client-init.js'),
    },
  });


  /**
   * Set the locations for built assets.
   *
   * FIXME: Prepending `public` is a workaround for Amphora's glitchy
   * interpretation of a site config's `assetDir`.
   */
  config.output
    .chunkFilename('scripts/[id].[contenthash].js')
    .crossOriginLoading('anonymous')
    .filename('scripts/[name].[contenthash].js')
    .path(path.join(process.cwd(), './public/public'))
    .publicPath('/public');

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

  config
    .plugin('define-globals')
      .use(DefinePlugin, [
        {
          DS: 'window.DS',
          'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV),
        }
      ]);

  config
    .plugin('clean')
      .use(CleanWebpackPlugin);

  config
    .plugin('progress')
      .use(ProgressPlugin, [
        {
          activeModules: true,
          percentBy: 'entries',
        }
      ]);

  config
    .plugin('vue-loader')
      .use(VueLoaderPlugin);

  config.module
    .rule('vue')
      .test(/\.vue$/)
      .use('vue-loader')
        .loader('vue-loader');

  config.module
    .rule('babel')
      .test(/\.js$/)
      .use('babel-loader')
        .loader('babel-loader')
        .options({
          presets: [
            '@babel/env'
          ]
        });

    config.module
      .rule('css')
        .test(/\.css$/)
        .use('style-loader')
          .loader('style-loader')
          .end()
        .use('css-loader')
          .loader('css-loader')
          .options({
            importLoaders: 1
          })
          .end()
        .use('postcss-loader')
          .loader('postcss-loader')
          .options({
            postcssOptions: {
              plugins: [
                cssImport(),
                mixins(),
                nested(),
                simpleVars(),
              ]
            }
          });

    config.optimization.runtimeChunk('single');

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
function buildProductionConfig(config) {
  /* eslint-disable indent --- It's easier to read config chains with extra indentation. */

  config
    .mode('production');

  config.optimization
    .minimize(true)
    .concatenateModules(true)
    .removeEmptyChunks(true)
    .removeAvailableModules(true)
    .splitChunks({
      chunks: 'all'
    })
    .merge({
      moduleIds: 'named',
      chunkIds: 'deterministic',
    });

  config
    .plugin('common-shake')
      .use(CommonShakePlugin);

  /* eslint-enable indent */

  return config;
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

  return globSync(glob)
    .reduce((entries, pathname) => {
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
  let client = createClientConfig(); // TODO: Add support for server builds.

  client = buildGlobalConfig(client);

  switch (process.env.CLAYCLI_COMPILE_MINIFIED) {
    case 'true':
      client = buildProductionConfig(client);
    case 'false':
    default:
      client = buildDevelopmentConfig(client);
  }

  client = buildCustomConfig(client);

  return client;
}

module.exports = getWebpackConfig;

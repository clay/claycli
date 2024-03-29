'use strict';

const {
  EvalSourceMapDevToolPlugin,
  HotModuleReplacementPlugin,
  NormalModuleReplacementPlugin,
  ProgressPlugin
} = require('webpack');
const _ = require('lodash');
const AssetManifestPlugin = require('webpack-assets-manifest');
const CaseSensitivePathsPlugin = require('case-sensitive-paths-webpack-plugin');
const Config = require('webpack-chain');
const cssImport = require('postcss-import');
const DotenvPlugin = require('dotenv-webpack');
const { getConfigValue } = require('../../config-file-helpers');
const mixins = require('postcss-mixins');
const MomentLocalesPlugin = require('moment-locales-webpack-plugin');
const nested = require('postcss-nested');
const path = require('path');
const simpleVars  = require('postcss-simple-vars');
const { VueLoaderPlugin } = require('vue-loader');
const helpers = require('../../compilation-helpers');

/**
 * Create a stateful webpack-chain configuration object and set sensible
 * defaults for a client-side build.
 *
 * @param {string[]} entryPoints - A list of globs which will serve as entry points.
 * @returns {Config} - A webpack-chain configuration object.
 */
function createClientConfig() {
  /* eslint-disable indent --- It's easier to read config chains with extra indentation. */

  const config = new Config();

  /**
   * Core build settings
   */
  config
    .name('clay-pack')
    .target('web') // TODO: Support serverside builds with target "node".
    .context(process.cwd());

  /**
   * Set the locations for built assets.
   */
  config.output
    .chunkFilename('scripts/[name].[contenthash].js')
    .filename('scripts/[name].[contenthash].js')
    .crossOriginLoading('anonymous')
    .path(path.join(process.cwd(), './public'))
    .publicPath('/');

  // Rewrite service modules that resolve to `server` so that they point to
  // `client`. There's no way around this without gut-renovating Sites, thanks
  // to {@link ../compile/scripts.js:103-123}.
  //
  // "And that's why... you don't write clever code."
  //    ---J. Walter Weatherman
  config
    .plugin('replace-server-services')
      .use(NormalModuleReplacementPlugin, [
        /server/,
        resource => {
          if (!resource.context.includes('services')) return;

          resource.request = resource.request.replace(/server/ig, 'client');
        }
      ]);

  /**
   * Ensure `import` and `require` statements are case-sensitive, even on
   * platforms (like macOS) which are not.
   */
  config
    .plugin('case-sensitive-paths')
      .use(CaseSensitivePathsPlugin);

  config
    .plugin('progress')
      .use(ProgressPlugin, [
        {
          activeModules: true
        }
      ]);

  config
    .plugin('vue-loader')
      .use(VueLoaderPlugin);

  config
    .plugin('base-environment')
      .use(DotenvPlugin, [
        {
          allowEmptyValues: true,
          path: './.env',
          systemvars: true
        }
      ]);

  config
    .plugin('moment-locales')
      .use(MomentLocalesPlugin);

  /**
   * Generate an asset manifest mapping source files to built assets. We ensure
   * the manifest includes all entrypoints, each of which is a complete
   * dependency chain for the source file.
   */
   config
    .plugin('asset-manifest')
      .use(AssetManifestPlugin, [
        {
          entrypoints: true
        }
      ]);

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
          exclude: [/node_modules[\\\/]/],
          plugins: [
            'lodash'
          ],
          presets: [
            ['@babel/env', {
              targets: helpers.getConfigFileOrBrowsersList('babelTargets'),
              modules: false
            }]
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

  config.optimization
    .runtimeChunk('single')
    .splitChunks({
      chunks: 'all',
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

  /**
   * `toConfig` is always defined on a webpack-chain configuration. A
   * non-webpack-chain object with a `toConfig` method could still fool us, but
   * that's not really our problem.
   */
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
  /* eslint-disable indent --- It's easier to read config chains with extra indentation. */

  config
    .mode('development');

  config.optimization
    .merge({
      chunkIds: 'named',
      moduleIds: 'named',
    });

    config
      .plugin('source-map')
        .use(EvalSourceMapDevToolPlugin, [
          {
            exclude: [/node_modules[\\\/]/]
          }
        ]);

    config
      .plugin('hmr')
        .use(HotModuleReplacementPlugin);

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
    .mode('production')
    .devtool('source-map');

  config.optimization
    .splitChunks({
      chunks: 'all'
    })
    .merge({
      chunkIds: 'deterministic',
      moduleIds: 'deterministic'
    });

  /* eslint-enable indent */

  return config;
}

/**
 * Generate a webpack-chain configuration object. Its settings will vary
 * depending on the current Node environment and the `claycli.config.js` file in
 * the consumer repo.
 *
 * @returns {Config} - The webpack-chain configuration object.
 */
function getWebpackConfig() {
  let client = createClientConfig(); // TODO: Support serverside builds.

  if (process.env.CLAYCLI_COMPILE_MINIFIED) {
    client = buildProductionConfig(client);
  } else {
    client = buildDevelopmentConfig(client);
  }

  client = buildCustomConfig(client);
  return client;
}

module.exports = getWebpackConfig;

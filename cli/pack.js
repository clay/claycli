'use strict';

const { getWebpackConfig } = require('../lib/cmd/pack');
const log = require('./log').setup({ file: __filename });
const webpack = require('webpack');

function builder(yargs) {
  return yargs
    .usage('Usage: $0')
    .example('$0', 'Compile the entrypoints configured in Webpack.');
}

/**
 * Run a one-off Webpack build.
 *
 * @param {webpack.Compiler} webpackCompiler - A configured Webpack compiler
 *    instance.
 * @returns {Promise} - A Promise that resolves when the compilation is
 *    complete.
 */
function handleAssetBuild(webpackCompiler) {
  return new Promise((resolve, reject) => {
    webpackCompiler.run((err, stats) => {
      if (err) {
        return reject(err);
      }

      if (stats.hasErrors()) {
        const msg = stats.toJson('errors-only');

        return reject(msg);
      }

      resolve(webpackCompiler);
    });
  }).then(compiler => {
    compiler.close(error => {
      if (error) {
        throw error;
      }
    });
  }).catch(error => {
    log('error', 'Webpack compilation failed', {
      error
    });
  });
}

/**
 * Run a Webpack build.
 *
 * @param {webpack.Compiler} webpackCompiler - A configured Webpack compiler
 *    instance.
 * @returns {Promise} - A Promise that resolves when the live compilation is
 *    terminated.
 */
function handleAssetWatch(webpackCompiler) {
  return new Promise((resolve, reject) => {
    const watchingInstance = webpackCompiler.watch(
      {
        ignored: /node_modules/
      },
      (err, stats) => {
        if (err) {
          return reject(err);
        }

        if (stats.hasErrors()) {
          const msg = stats.toJson('errors-only');

          return reject(msg);
        }
      }
    );

    resolve(watchingInstance);
  }).then(watching => {
    process.on('exit', () => {
      watching.close(error => {
        if (error) {
          throw error;
        }
      });
    });
  }).catch(error => {
    log('error', 'Webpack compilation failed', {
      message: error.message,
      stack: error.stack
    });
  });
}

function handler(argv) {
  const config = getWebpackConfig(argv).toConfig();
  const compiler = webpack(config);
  const builder = argv.watch ? handleAssetWatch.bind(null, compiler) : handleAssetBuild.bind(null, compiler);

  return builder();
}

exports.aliases = ['p'];
exports.builder = builder;
exports.command = 'pack';
exports.describe = 'Compile Webpack assets';
exports.handler = handler;

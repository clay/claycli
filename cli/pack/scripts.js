'use strict';

const { getWebpackConfig } = require('../../lib/cmd/pack');
const log = require('../log').setup({ file: __filename });
const options = require('./options');
const webpack = require('webpack');

function builder(yargs) {
  return yargs
    .usage('Usage: $0 scripts [globs..]')
    .example('$0 scripts "./components/**/client.js"', 'Compile all "client.js" files under "./components"')
    .positional(...options.globs);
}

function handler(argv) {
  const config = getWebpackConfig(argv).toConfig();
  const compiler = webpack(config);

  return new Promise((resolve, reject) => {
    compiler.run((err, stats) => {
      if (err) {
        return reject(err);
      }

      if (stats.hasErrors()) {
        const msg = stats.toString('errors-only');

        reject(new Error(msg));
      }

      resolve();
    });
  }).catch((err) => {
    log('error', 'Script compilation failed', {
      message: err.message,
      stack: err.stack
    });

    throw err;
  });
}

exports.command = 'scripts [globs..]';
exports.description = 'Compile scripts with Webpack';
exports.builder = builder;
exports.handler = handler;

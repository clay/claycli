'use strict';

const getPackConfig = require('./config'),
  webpack = require('webpack');

function builder(yargs) {
  return yargs
    .usage('Usage: $0 pack');
}

async function handler() {
  const config = getPackConfig().toConfig();
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
  });
}

exports.aliases = ['p'];
exports.builder = builder;
exports.command = 'pack';
exports.describe = 'Compile Webpack assets';
exports.handler = handler;

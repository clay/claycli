'use strict';

const options = require('./options');
const { handler: scriptsHandler } = require('./scripts');
const log = require('../log').setup({ file: __filename });

function builder(yargs) {
  return yargs
    .usage('Usage: $0 pack [asset] [globs..]')
    .example('$0 pack', 'compile all assets with webpack')
    .example('$0 pack "./components/**/client.js"', 'compile component JavaScript assets with webpack')
    .positional(...options.asset)     // FIXME: Duplicative optional positional arguments.
    .positional(...options.globs)     // FIXME: Duplicative optional positional options.
    .command(require('./scripts'));
}

async function handler(argv) {
  return Promise.allSettled([
    scriptsHandler(argv)
  ]).catch(err => {
    log('error', 'Asset compilation failed', {
      message: err.message,
      stack: err.stack
    });

    throw err;
  });
}

exports.aliases = ['p'];
exports.builder = builder;
exports.command = 'pack';
exports.describe = 'Compile Webpack assets';
exports.handler = handler;

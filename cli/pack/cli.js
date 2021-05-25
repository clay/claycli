'use strict';

const { handler: scriptsHandler } = require('./scripts');
const log = require('../log').setup({ file: __filename });

function builder(yargs) {
  return yargs
    .usage('Usage: $0 pack')
    .example('$0 pack', 'compile all assets with webpack')
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

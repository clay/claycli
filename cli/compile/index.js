'use strict';
const compile = require('../../lib/cmd/compile'),
  options = require('../cli-options');

function builder(yargs) {
  return yargs
    .usage('Usage: $0 compile [asset type]')
    .command(require('./fonts'))
    .example('$0 compile', 'compile all assets')
    .example('$0 compile --watch', 'compile and watch all assets')
    .option('w', options.watch)
    .option('m', options.minify);
}

function handler(argv) {
  return compile.fonts({ watch: argv.watch, minify: argv.minify });
}

module.exports = {
  command: 'compile [asset type]',
  describe: 'Compile fonts, media, styles, scripts, and templates',
  aliases: ['compiler', 'c'],
  builder,
  handler
};

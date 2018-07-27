'use strict';
const compile = require('../../lib/cmd/compile'),
  options = require('../cli-options');

function builder(yargs) {
  return yargs
    .usage('Usage: $0 fonts')
    .example('$0 fonts', 'compile linked fonts')
    .example('$0 fonts --watch', 'compile and watch linked fonts')
    .example('$0 fonts --inlined --linked', 'compile inlined and linked fonts')
    .option('w', options.watch)
    .option('m', options.minify)
    .option('i', options.inlined)
    .option('l', options.linked);
}

function handler(argv) {
  return compile.fonts({
    watch: argv.watch,
    minify: argv.minify,
    inlined: argv.inlined,
    linked: argv.linked
  });
}

module.exports = {
  command: 'fonts',
  describe: 'Compile fonts',
  aliases: ['f'],
  builder,
  handler
};

const _ = require('lodash'),
  options = require('../utils/shared-options'),
  config = require('../utils/config'),
  logger = require('../utils/logger'),
  compilers = require('../compilers');

function builder(yargs) {
  return yargs
    .usage('Usage: $0 compile [type]')
    .example('$0 compile', 'compile and watch everything in current directory')
    .example('$0 compile -f path/to/sites', 'compile and watch everything in specified directory')
    .example('$0 compile scripts', 'compile and watch scripts')
    .example('$0 compile styles', 'compile and watch styles')
    .example('$0 compile media', 'compile and watch images and fonts')
    .example('$0 compile --production', 'compile and minify everything in current directory')
    .option('f', options.file)
    .option('p', options.production);
}

function handler(argv) {
  let type = argv.type,
    root;

  if (type && !_.isFunction(compilers[type])) {
    logger.error(`Unknown compiler specified: ${type}`);
    process.exit(1);
  }

  if (argv.file) {
    root = config.getFile(argv.file);
  } else {
    root = process.cwd();
  }

  return compilers[type](root, argv);
}

module.exports = {
  command: 'compile [type]',
  describe: 'compile clay scripts, styles, and media',
  aliases: ['build'],
  builder,
  handler
};

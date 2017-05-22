const _ = require('lodash'),
  bluebird = require('bluebird'),
  clayUtils = require('clay-utils'),
  hl = require('highland'),
  chalk = require('chalk'),
  pluralize = require('pluralize'),
  options = require('../utils/shared-options'),
  config = require('../utils/config'),
  logger = require('../utils/logger'),
  clay = require('../io/input-clay'),
  files = require('../io/input-files'),
  rest = require('../utils/rest');

function builder(yargs) {
  return yargs
    .usage('Usage: $0 import [input] [options] <clay site>')
    .example('wordpress-importer | $0 import', 'pipe from importer into CLAY_DEFAULT_SITE')
    .example('$0 import -s prod local', 'import prod pages to local')
    .example('$0 import -s prod -u qa', 'import prod users to qa')
    .example('$0 import -p domain.com/pages/d8f76f local', 'import specific page to local')
    .example('$0 import -f bootstraps/ local', 'import bootstrap files to local')
    .option('f', options.file)
    .option('s', options.site)
    .option('c', options.component)
    .option('p', options.page)
    .option('k', options.key);
}

function handler(argv) {
  // todo: handle stdin

  if (!config.getKey(argv.key)) {
    logger.error('No api key defined!', '\nPlease use --key or set CLAY_DEFAULT_KEY');
  } else if (!config.getSite(argv.url)) {
    logger.error('No Clay site defined to import into!', '\nPlease specify site or set CLAY_DEFAULT_SITE');
  } else if (!argv.site && !argv.file && !argv.component && !argv.page) {
    logger.error('No data to import!', 'Please specify site, file(s), component, or page to import');
  } else if (argv.component && clayUtils.isComponent(argv.component)) {
    const url = config.normalizeSite(argv.component);

    console.log(`GET and import component: ${url}`)
  } else if (argv.page && clayUtils.isPage(argv.page)) {
    const url = config.normalizeSite(argv.page);

    console.log(`GET and import page: ${url}`)
  } else if (argv.file) {
    const filename = config.getFile(argv.file);

    console.log(`import file(s): ${filename}`)
  } else if (argv.site) {
    const prefix = config.getSite(argv.site);

    // todo: figure out how to import parts of a site
    console.log(`import site: ${prefix}`)
  }
}

module.exports = {
  command: 'import [url]',
  describe: 'import stuff into clay',
  aliases: ['i', 'importer'],
  builder,
  handler
};

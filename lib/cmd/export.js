'use strict';

const _ = require('lodash'),
  options = require('../utils/shared-options'),
  config = require('../utils/config'),
  logger = require('../utils/logger'),
  chunks = require('../io/agnostic-chunks'),
  clayInput = require('../io/input-clay'),
  files = require('../io/output-files');

/**
 * handle errors and exit when importer fails
 * @param  {Error} err
 */
function fatalError(err) {
  logger.error('Unable to process input!', err.message);
  logger.debug(err.stack);
  process.exit(1);
}

/**
 * show a summary after the import succeeds
 * @param  {array} results
 */
function showCompleted(results) {
  const result = _.head(results); // there can be only one

  if (result.result === 'success') {
    logger.success(`Exported data to ${result.filename}`);
  } else {
    logger.error(`Could not export data to ${result.filename}`, result.message);
  }
}

/**
 * export data from a single component/page url
 * @param  {string} url
 * @param {string} filename
 * @param  {object} argv
 * @return {Stream}
 */
function exportSingleUrl(url, filename, argv) {
  let stream = clayInput.importUrl(url, argv.concurrency)
    .flatMap(chunks.parseDeepObject)
    .stopOnError(fatalError); // exit early if there's a problem reaching the input clay instance

  if (filename) {
    logger.info('Exporting single URL:', `\n${url}\n↓ ↓ ↓\n${filename}`);
    // export to a file, then notify the user
    return stream
      .collect() // the data into a single array
      .flatMap(files.saveBootstrap(filename)) // format it like a bootstrap file and save
      .toArray(showCompleted);
  } else {
    // export to stdout (no logging, since all stdout should be able to be piped to other places)
    return stream
      .map(JSON.stringify)
      .intersperse('\n')
      .pipe(process.stdout);
  }
}

function exportSite() {
  logger.error('Site export not supported yet!');
}


function builder(yargs) {
  return yargs
    .usage('Usage: $0 export [--site, --page, --component] [file]')
    .example('$0 export -c domain.com/components/foo', 'export component to stdout')
    .example('$0 export -c domain.com/components/foo backup.json', 'export component to json')
    .example('$0 export -p domain.com/pages/123 page-backup', 'export page to yaml')
    .example('$0 export -s prod -l 10', 'export latest 10 pages from site')
    .example('$0 export -s prod -l 0 -u --lists', 'export only users and lists')
    .example('$0 export -s prod -l 500 -o 100', 'export latest 500 pages, offset by 100')
    .example('$0 export -s prod -q path/to/query.yaml', 'export specific pages by querying elastic')
    // inputs
    .option('s', options.site)
    .option('p', options.page)
    .option('c', options.component)
    // site-specific options
    .option('u', options.users)
    .option('lists', options.lists)
    .option('l', options.limit)
    .option('o', options.offset)
    .option('q', options.query);
}

function handler(argv) {
  const filename = argv.file ? config.getFile(argv.file) : null;

  // handle different types of exports
  if (argv.component) {
    return exportSingleUrl(config.normalizeSite(argv.component), filename, argv);
  } else if (argv.page) {
    return exportSingleUrl(config.normalizeSite(argv.page), filename, argv);
  } else if (argv.site) {
    return exportSite(config.getSite(argv.site), filename, argv);
  } else {
    logger.error('Please specify somewhere to export from!');
    process.exit(1);
  }
}

module.exports = {
  command: 'export [file]',
  describe: 'export data from a clay site',
  aliases: ['e', 'exporter'],
  builder,
  handler
};

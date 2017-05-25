const _ = require('lodash'),
  h = require('highland'),
  byline = require('byline'),
  pluralize = require('pluralize'),
  options = require('../utils/shared-options'),
  config = require('../utils/config'),
  logger = require('../utils/logger'),
  chunks = require('../io/agnostic-chunks'),
  clayInput = require('../io/input-clay');

/**
 * handle errors when agnostic chunks fail validation
 * @param  {Error} err
 */
function validationError(err) {
  logger.error('Unable to process input!', err.message);
  process.exit(1);
}

function showProgress(prefix, argv) {
  return (chunk) => {
    if (argv.verbose) {
      logger.debug(Object.keys(chunk)[0]);
    } else {
      process.stdout.write('.');
    }
    return chunk;
  };
}

function showCompleted(prefix, argv) {
  return (results) => {
    process.stdout.write('\n'); // log BELOW the dots
    logger.info(`Imported ${pluralize('uri', results.length, true)}!`);
    logger.debug('Detailed Information:', _.map(results, (chunk) => Object.keys(chunk)[0]).join('\n'));
  };
}

/**
 * import data from stdin
 * @param  {string} prefix of site to import into
 * @param  {object} argv
 * @return {Stream}
 */
function importStream(prefix, argv) {
  return h(byline(process.stdin)) // byline splits on newlines and removes empty lines
    .map(JSON.parse)
    .map(chunks.validate)
    .stopOnError(validationError)
    .map(showProgress(prefix, argv))
    .toArray(showCompleted(prefix, argv));
}

/**
 * import data from a single component/page url
 * @param  {string} url
 * @param  {string} prefix of site to import into
 * @param  {object} argv
 * @return {Stream}
 */
function importSingleUrl(url, prefix, argv) {
  logger.info('Importing single URL:', `\n${url}\n↓ ↓ ↓\n${prefix}`);
  return clayInput.recursiveGet(url, argv.concurrency)
    .errors((err, push) => {
      console.log(err)
      push(err)
    })
    .map(chunks.validate)
    .stopOnError(validationError)
    .map(showProgress(prefix, argv))
    .toArray(showCompleted(prefix, argv));
}

function builder(yargs) {
  return yargs
    .usage('Usage: $0 import [--site, --file, --page, --component] [site]')
    .example('$0 import -c domain.com/components/foo', 'import component to CLAY_DEFAULT_SITE')
    .example('$0 import -p domain.com/pages/123 local', 'import page to local')
    .example('$0 import -f path/to/data.yml local', 'import from file')
    .example('$0 import -s prod local -l 10', 'import latest 10 pages from site')
    .example('$0 import -s prod local -l 0 -u --lists', 'import only users and lists')
    .example('$0 import -s prod local -l 500 -o 100', 'import latest 500 pages, offset by 100')
    .example('$0 import -s prod local -q path/to/query.yaml', 'import specific pages by querying elastic')
    .example('wordpress-to-clay | $0 import local', 'import from stdin')
    // inputs
    // not listed: stdin
    .option('f', options.file)
    .option('s', options.site)
    .option('p', options.page)
    .option('c', options.component)
    // site-specific options
    .option('u', options.users)
    .option('lists', options.lists)
    .option('l', options.limit)
    .option('o', options.offset)
    .option('q', options.query)
    // other options
    .option('n', options.dryRun)
    .option('force', options.force);
}

function handler(argv) {
  const prefix = config.getSite(argv.prefix);

  // first, make sure we have a place to import into
  if (!prefix) {
    logger.error('Please specify somewhere to import to!', `Unable to parse "${argv.prefix}"`);
    process.exit(1);
  }

  // handle different types of imports
  if (_.isUndefined(process.stdin.isTTY)) {
    return importStream(prefix, argv);
  } else if (argv.component) {
    return importSingleUrl(config.normalizeSite(argv.component), prefix, argv);
  } else if (argv.page) {
    return importSingleUrl(config.normalizeSite(argv.page), prefix, argv);
  } else if (argv.site) {
    return importSite(config.getSite(argv.site), prefix, argv);
  } else if (argv.file) {
    return importFile(config.getFile(argv.file), prefix, argv);
  } else {
    logger.error('Please specify somewhere to import from!');
    process.exit(1);
  }
}

module.exports = {
  command: 'import [prefix]',
  describe: 'import data into a clay site',
  aliases: ['i', 'importer'],
  builder,
  handler
};

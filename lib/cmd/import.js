const _ = require('lodash'),
  h = require('highland'),
  byline = require('byline'),
  chalk = require('chalk'),
  pluralize = require('pluralize'),
  options = require('../utils/shared-options'),
  config = require('../utils/config'),
  logger = require('../utils/logger'),
  urlUtil = require('../utils/urls'),
  importApi = require('../api/import'),
  getYargHeaders = require('../utils/headers').getYargHeaders,
  singleLineLog = require('single-line-log').stdout;

/**
 * Convert errors into result objects and pass them along.
 * @param {Error} err
 * @param {Function} push
 */
function passErrors(err, push) {
  push(null, {
    status: 'error',
    url: err.url,
    error: err
  });
}

/**
 * show progress as we import things
 * @param  {object} argv
 * @return {function}
 */
function showProgress(argv) {
  return argv.verbose ? verboseLogger() : dotLogger();
}

/**
* Returns a function that logs import results.
* @return {function}
*/
function verboseLogger() {
  return ({status, url, error}) => {
    if (status === 'success') {
      logger.debug(`${chalk.green('✓')} PUT ${url}`);
    } else if (status === 'skipped') {
      logger.debug(`${chalk.yellow('Skip:')} PUT ${url}`);
    } else if (status === 'error') {
      logger.debug(`${chalk.red('✗')} ${error.method} ${error.url} ${error.message}`);
    }
  };
}

/**
* Returns a function that logs import results.
* @return {function}
*/
function dotLogger() {
  let totalCount = 0,
    successCount = 0,
    errorCount = 0,
    skippedCount = 0,
    maxDots = 50,
    dots = '';

  return ({status}) => {
    if (totalCount % maxDots === 0) dots = '';
    if (status === 'success') {
      successCount++;
      dots += chalk.green('.');
    } else if (status === 'skipped') {
      skippedCount++;
      dots += chalk.yellow('.');
    } else if (status === 'error') {
      errorCount++;
      dots += chalk.red('.');
    }
    success = chalk.green(_.padEnd(successCount, 5));
    failed = chalk.red(_.padEnd(errorCount, 5));
    skipped = chalk.yellow(_.padEnd(skippedCount, 5));
    singleLineLog(`${dots}\nAssets imported: ${success} Failed: ${failed} Skipped: ${skipped}`);
    totalCount++;
  };
}

/**
 * show a summary after the import succeeds
 * @param  {array} results
 */
function showCompleted(results) {
  const successResults = _.filter(results, { status: 'success' }),
    errorResults = _.filter(results, { status: 'error' }),
    skippedResults = _.filter(results, {status: 'skipped'});

  process.stdout.write('\n');
  if (successResults.length) {
    logger.success(`Imported ${pluralize('resource', successResults.length, true)}!`);
  } else {
    logger.error('Imported 0 uris (´°ω°`)');
  }
  if (skippedResults.length) {
    logger.info(`Skipped import of ${pluralize('Clay asset', skippedResults.length, true)} because they appeared as layouts or layout children and already exist in the target site. Use --overwriteLayouts to overwrite them.`);
  }
  if (errorResults.length) {
    logger.warn(`Import of ${pluralize('resource', errorResults.length, true)} failed due to errors:`, '\n' + _.map(errorResults, (result) => result.error.url).join('\n'));
    logger.warn('For more information, run again with --verbose');
  }
  logger.debug('Detailed Information:', '\n' + _.map(results, (result) => {
    if (result.status === 'success') {
      return `✓ ${result.url}`;
    } else if (result.status === 'skipped') {
      return `skipped: ${result.url}`;
    } else {
      return `✗ ${result.url}\n  → ${result.error} ${result.message}`;
    }
  }).join('\n'));
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
    .flatMap(chunk => importApi.importChunk(chunk, argv.prefix, {
      key: argv.key,
      headers: argv.headers,
      concurrency: argv.concurrency
    }))
    .stopOnError(passErrors)
    .doto(showProgress(argv))
    .toArray(showCompleted);
}

/**
 * Imports a site.
 * @param {Object} argv
 * @return {Stream}
 */
function importSite(argv) {
  const site = argv.site,
    prefix = argv.prefix;

  logger.info('Importing site:', `\n${site}\n↓ ↓ ↓\n${prefix}`);

  return importApi.importSite(site, prefix, argv)
    .errors(passErrors)
    .doto(showProgress(argv))
    .toArray(showCompleted);
}

/**
 * Imports a single URL.
 * @param {Object} argv
 * @return {Stream}
 */
function importUrl(argv) {
  const url = argv.url,
    prefix = argv.prefix,
    newUrl = urlUtil.uriToUrl(prefix, url);

  logger.info('Importing single URL:', `\n${url}\n↓ ↓ ↓\n${newUrl}`);
  return importApi.importUrl(url, prefix, argv)
    .errors(passErrors)
    .doto(showProgress(argv))
    .toArray(showCompleted);
}

function importFile(argv) {
  logger.debug(`Attempting to import ${argv.file}`);
  return importApi.importFile(argv.file, argv.prefix, argv)
    .errors(passErrors)
    .doto(showProgress(argv))
    .toArray(showCompleted);
}

function builder(yargs) {
  return yargs
    .usage('Usage: $0 import [--site, --file, --page, --component] [site]')
    .example('$0 import -c domain.com/components/foo', 'import component to CLAY_DEFAULT_SITE')
    .example('$0 import -p domain.com/pages/123 local', 'import page to local')
    .example('$0 import -f path/to/data.yml local', 'import from file')
    .example('$0 import -s prod local -l 10', 'import latest 10 pages from site')
    .example('$0 import -s prod local -l 500 -o 100', 'import latest 500 pages, offset by 100')
    .example('$0 import -s prod local --overwriteLayouts', 'import last 100 pages, overwriting layouts in local site')
    .example('$0 import -s prod local -q path/to/query.yaml', 'import specific pages by querying elastic')
    .example('$0 import -f prod-data.yml prod -k prod', 'import file to prod using key')
    .example('wordpress-to-clay | $0 import local', 'import from stdin')
    // inputs
    // not listed: stdin
    .option('f', options.file)
    .option('s', options.site)
    // site-specific options
    .option('sourceKey', options.sourceKey)
    .option('l', options.limit)
    .option('o', options.offset)
    .option('q', options.query)
    // other options
    .option('k', options.key)
    .option('headers', options.headers)
    // site and page imports
    .option('published', options.published)
    .option('overwriteLayouts', options.overwriteLayouts);
}

/**
 * Normalize options in argv.
 * @param {Object} argv
 */
function normalizeArgv(argv) {
  argv.prefix = config.getSite(argv.prefix),
  argv.key = config.getKey(argv.key),
  argv.headers = getYargHeaders(argv);
  if (argv.site) {
    argv.site = config.getSite(argv.site);
  }
  if (argv.file) {
    argv.file = config.getFile(argv.file);
  }
  if (argv.url) {
    config.normalizeSite(argv.url);
  }
}

/**
 * Assert argv is valid.
 * @param {Object} argv
 */
function assertValidArgv(argv) {
  // Make sure we have a place to import into...
  if (!argv.prefix) {
    logger.error('Please specify somewhere to import to!', `Unable to parse "${argv.prefix}"`);
    process.exit(1);
  }
  // ...and an api key to import with
  if (!argv.key) {
    logger.error('Please specify an api key!', `Unable to parse "${argv.key}"`);
    process.exit(1);
  }
}

function handler(argv) {
  normalizeArgv(argv);
  assertValidArgv(argv);

  // handle different types of imports
  if (_.isUndefined(process.stdin.isTTY)) {
    importStream(prefix, argv);
  } else if (argv.url) {
    importUrl(argv);
  } else if (argv.file) {
    importFile(argv);
  } else if (argv.site) {
    importSite(argv);
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

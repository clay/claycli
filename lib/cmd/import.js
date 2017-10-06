const _ = require('lodash'),
  h = require('highland'),
  byline = require('byline'),
  chalk = require('chalk'),
  pluralize = require('pluralize'),
  options = require('../utils/shared-options'),
  config = require('../utils/config'),
  logger = require('../utils/logger'),
  chunks = require('../io/agnostic-chunks'),
  urlUtil = require('../utils/urls'),
  rest = require('../utils/rest'),
  importApi = require('../api/import'),
  getYargHeaders = require('../utils/headers').getYargHeaders,
  singleLineLog = require('single-line-log').stdout;


/**
 * handle errors and exit when importer fails
 * @param  {Error} err
 */
function fatalError(err) {
  logger.error('Unable to process input!', err.message);
  logger.debug(err.stack);
}

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
  let successCount = 0,
    errorCount = 0,
    skippedCount = 0,
    totalCount = 0,
    dots = '';

  return (result) => {
    // verbose mode gives you the urls

    if (totalCount % 50 === 0) dots = '';
    if (argv.verbose && result.status === 'success') {
      logger.debug(`${chalk.green('✓')} PUT ${result.url}`);
    } else if (argv.verbose && result.status === 'error') {
      logger.debug(`${chalk.red('✗')} ${result.error.method} ${result.error.url} ${result.error.message}`);
      console.log('err', result.error);
      // non-verbose mode just gives you dots
    } else if (result.status === 'success') {
      successCount++;
      dots += chalk.green('.');
    } else if (result.status === 'error') {
      errorCount++;
      dots += chalk.red('.');
    } else if (result.status === 'skipped') {
      skippedCount++;
      dots += chalk.yellow('.');
    }
    if (!argv.verbose) {
      const success = chalk.green(_.padEnd(successCount, 5)),
        failed = chalk.red(_.padEnd(errorCount, 5)),
        skipped = chalk.yellow(_.padEnd(skippedCount, 5));

      singleLineLog(`${dots}\nResources imported: ${success} Failed: ${failed} Skipped: ${skipped}`);
    }
    totalCount++;
    return result;
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
    logger.info(`Skipped ${pluralize('resource', skippedResults.length, true)} because they already exist.`, '\n' + _.map(skippedResults, (result) => result.url).join('\n'));
    logger.info('Use --overwrite to specify the resource types you want to overwrite (use "all" or a combination of "components", "layouts", "pages", or "lists")');
  }
  if (errorResults.length) {
    logger.warn(`Import of ${pluralize('resource', errorResults.length, true)} failed due to errors:`, '\n' + _.map(errorResults, (result) => result.error.url).join('\n'));
    logger.warn('For more information, run again with --verbose');
  }
  logger.debug('Detailed Information:', '\n' + _.map(results, (result) => {
    if (result.status === 'success') {
      return `✓ ${result.url}`;
    } else {
      return `✗ ${result.url}\n  → ${result.error}`;
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
  const key = config.getKey(argv.key);

  return h(byline(process.stdin)) // byline splits on newlines and removes empty lines
    .map(JSON.parse)
    .map(chunks.validate) // validate chunks coming in from stdin
    .stopOnError(fatalError)
    // map agnostic chunks to data we can save
    .map(mapChunksToData(prefix))
    .flatMap((item) => rest.put(item, {
      key,
      concurrency: argv.concurrency,
      type: _.includes(item.url, '/uris') ? 'text' : 'json',
      headers
    }))
    .stopOnError(passErrors)
    .map(showProgress(argv))
    .toArray(showCompleted);
}

/**
 * Imports a site.
 * @param {string} site
 * @param {string} prefix
 * @param {Object} argv
 * @return {Stream}
 */
function importSite(site, prefix, argv) {
  logger.info('Importing site:', `\n${site}\n↓ ↓ ↓\n${prefix}`);

  return importApi.importSite(site, prefix, argv)
    .errors(passErrors)
    .map(showProgress(argv))
    .toArray(showCompleted);
}

/**
 * Imports a single URL.
 * @param {string} url URL to import
 * @param {string} prefix Prefix of the target site
 * @param {Object} argv
 * @return {Stream}
 */
function importUrl(url, prefix, argv) {
  const newUrl = urlUtil.uriToUrl(prefix, url);

  logger.info('Importing single URL:', `\n${url}\n↓ ↓ ↓\n${newUrl}`);
  return importApi.importUrl(url, prefix, argv)
    .errors(passErrors)
    .map(showProgress(argv))
    .toArray(showCompleted);
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
    .example('$0 import -s prod local --overwrite all', 'import last 100 pages, overwriting layouts in local site')
    .example('$0 import -s prod local --lists', 'import lat 100 pages and merge lists from prod into local')
    .example('$0 import -s prod local -q path/to/query.yaml', 'import specific pages by querying elastic')
    .example('$0 import -f prod-data.yml prod -k prod', 'import file to prod using key')
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
    .option('sourceKey', options.sourceKey)
    .option('l', options.limit)
    .option('o', options.offset)
    .option('q', options.query)
    // other options
    .option('k', options.key)
    .option('headers', options.headers)
    // site and page imports
    .option('published', options.published)
    .option('overwrite', options.overwrite);
}

function handler(argv) {
  const prefix = config.getSite(argv.prefix),
    key = config.getKey(argv.key),
    headers = getYargHeaders(argv);

  // first, make sure we have a place to import into...
  if (!prefix) {
    logger.error('Please specify somewhere to import to!', `Unable to parse "${argv.prefix}"`);
    process.exit(1);
  }

  // ...and an api key to import with
  if (!argv.key) {
    logger.error('Please specify an api key!', `Unable to parse "${argv.key}"`);
    process.exit(1);
  }

  _.assign(argv, {prefix, key, headers});

  // handle different types of imports
  if (_.isUndefined(process.stdin.isTTY)) {
    importStream(prefix, argv);
  } else if (argv.component) {
    argv.component = config.normalizeSite(argv.component);
    importUrl(argv.component, prefix, argv);
  } else if (argv.page) {
    argv.page = config.normalizeSite(argv.page);
    importUrl(argv.page, prefix, argv);
  } else if (argv.site) {
    argv.site = config.getSite(argv.site);
    importSite(argv.site, prefix, argv);
  } else if (argv.file) {
    argv.file = config.getFile(argv.file);
    importFile(argv);
  } else {
    logger.error('Please specify somewhere to import from!');
    process.exit(1);
  }
}

function importFile(argv) {
  logger.debug(`Attempting to import ${filepath}`);
  return importApi.importFile(argv.file, prefix, argv)
    .errors(passErrors)
    .map(showProgress(argv))
    .toArray(showCompleted);
}

module.exports = {
  command: 'import [prefix]',
  describe: 'import data into a clay site',
  aliases: ['i', 'importer'],
  builder,
  handler
};

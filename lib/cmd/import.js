'use strict';

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
  clayInput = require('../io/input-clay'),
  files = require('../io/input-files'),
  getYargHeaders = require('../utils/headers').getYargHeaders;

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
 * map agnostic chunks into PUTtable data
 * @param  {string} prefix
 * @return {function}
 */
function mapChunksToData(prefix) {
  const uriPrefix = urlUtil.urlToUri(prefix);

  return (chunk) => {
    const withPrefix = chunks.fromChunk(uriPrefix, chunk),
      uri = Object.keys(withPrefix)[0],
      val = withPrefix[uri],
      data = _.isString(val) ? val : JSON.stringify(val), // val might be data or uri string
      url = urlUtil.uriToUrl(prefix, uri);

    return {
      url,
      data
    };
  };
}

/**
 * show progress as we import things
 * @param  {object} argv
 * @return {function}
 */
function showProgress(argv) {
  return (result) => {
    // verbose mode gives you the urls
    if (argv.verbose && result.result === 'success') {
      logger.debug(`${chalk.green('✓')} PUT ${result.url}`);
    } else if (argv.verbose && result.result === 'error') {
      logger.debug(`${chalk.red('✗')} PUT ${result.url}\n${result.message}`);
      // non-verbose mode just gives you dots
    } else if (result.result === 'success') {
      process.stdout.write(chalk.green('.'));
    } else if (result.result === 'error') {
      process.stdout.write(chalk.red('.'));
    }
    return result;
  };
}

/**
 * show a summary after the import succeeds
 * @param  {array} results
 */
function showCompleted(results) {
  const successes = _.filter(results, { result: 'success' }),
    errors = _.filter(results, { result: 'error' });

  process.stdout.write('\n'); // log BELOW the dots
  if (successes.length) {
    logger.success(`Imported ${pluralize('uri', successes.length, true)}!`);
  } else {
    logger.error('Imported 0 uris (´°ω°`)');
  }

  if (errors.length) {
    logger.warn(`Skipped ${pluralize('uri', errors.length, true)} due to errors:`, '\n' + _.map(errors, (error) => error.url).join('\n'));
  }
  logger.debug('Detailed Information:', '\n' + _.map(results, (result) => {
    if (result.result === 'success') {
      return `✓ ${result.url}`;
    } else {
      return `✗ ${result.url}\n  → ${result.message}`;
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
  const key = config.getKey(argv.key),
    headers = getYargHeaders(argv);

  return h(byline(process.stdin)) // byline splits on newlines and removes empty lines
    .map(JSON.parse)
    .map(chunks.validate) // validate chunks coming in from stdin
    .stopOnError(fatalError)
    // map agnostic chunks to data we can save
    .map(mapChunksToData(prefix))
    .flatMap((item) => rest.put(item, {
      key,
      concurrency: argv.concurrency,
      type: _.includes(item.url, '/_uris') ? 'text' : 'json',
      headers
    }))
    .map(showProgress(argv))
    .toArray(showCompleted);
}

/**
 * import data from a single component/page url
 * @param  {string} url
 * @param  {string} prefix of site to import into
 * @param  {object} argv
 * @return {Stream}
 */
function importSingleUrl(url, prefix, argv) {
  const key = config.getKey(argv.key),
    newUrl = urlUtil.uriToUrl(prefix, url),
    headers = getYargHeaders(argv);

  logger.info('Importing single URL:', `\n${url}\n↓ ↓ ↓\n${newUrl}`);
  return clayInput.importUrl(url, argv.concurrency)
    .flatMap(chunks.replacePrefixes(prefix))
    .stopOnError(fatalError) // exit early if there's a problem reaching the input clay instance
    .flatMap((item) => rest.put(item, {
      key,
      concurrency: argv.concurrency,
      type: 'json',
      headers
    }))
    .map(showProgress(argv))
    .toArray(showCompleted);
}

function importSite() {
  logger.error('Site import not supported yet!');
}

/**
 * import data from YAML/JSON files
 * @param  {string} filepath
 * @param  {string} prefix
 * @param  {object} argv
 * @return {Stream}
 */
function importFile(filepath, prefix, argv) {
  const key = config.getKey(argv.key),
    headers = getYargHeaders(argv);

  logger.debug(`Attempting to import ${filepath}`);
  return files.get(filepath, true).stopOnError((error) => {
    const location = error.filepath && `\nFound in ${error.filepath}`;

    logger.error(error.message, location); // yaml parsing errors will have filepath
    process.exit(1); // exit early
  })
    .filter(files.omitSchemas)
    .map(chunks.validate)
    // map agnostic chunks to data we can save
    .map(mapChunksToData(prefix))
    .flatMap((item) => rest.put(item, {
      key,
      concurrency: argv.concurrency,
      type: _.includes(item.url, '/_uris') ? 'text' : 'json',
      headers
    }))
    .map(showProgress(argv))
    .toArray(showCompleted);
}

function builder(yargs) {
  return yargs
    .usage('Usage: $0 import [--site, --file, --page, --component] [site]')
    .example('$0 import -c domain.com/_components/foo', 'import component to CLAY_DEFAULT_SITE')
    .example('$0 import -p domain.com/_pages/123 local', 'import page to local')
    .example('$0 import -f path/to/data.yml local', 'import from file')
    .example('$0 import -s prod local -l 10', 'import latest 10 pages from site')
    .example('$0 import -s prod local -l 0 -u --lists', 'import only users and lists')
    .example('$0 import -s prod local -l 500 -o 100', 'import latest 500 pages, offset by 100')
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
    .option('l', options.limit)
    .option('o', options.offset)
    .option('q', options.query)
    // other options
    .option('k', options.key)
    .option('headers', options.headers);
}

function handler(argv) {
  const prefix = config.getSite(argv.prefix);

  // first, make sure we have a place to import into...
  if (!prefix) {
    logger.error('Please specify somewhere to import to!', `Unable to parse "${argv.prefix}"`);
    process.exit(1);
  }

  // ...and an api key to import with
  if (!config.getKey(argv.key)) {
    logger.error('Please specify an api key!', `Unable to parse "${argv.key}"`);
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

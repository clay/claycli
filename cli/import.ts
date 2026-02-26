const _ = require('lodash'),
  pluralize = require('pluralize'),
  chalk = require('chalk'),
  options = require('./cli-options'),
  reporter = require('../lib/reporters'),
  importItems = require('../lib/cmd/import');

function builder(yargs: any) {
  return yargs
    .usage('Usage: $0 import [url]')
    .example('$0 import --key prod domain.com < db_dump.clay', 'Import dispatch from stdin')
    .example('$0 import --key prod --publish domain.com < db_dump.clay', 'Import and publish page')
    .example('$0 import --key prod --yaml domain.com < bootstrap.yml', 'Import bootstrap from stdin')
    .option('k', options.key)
    .option('c', options.concurrency)
    .option('p', options.publish)
    .option('y', options.yaml)
    .option('r', options.reporter);
}

/**
 * show progress as we import things
 * @param  {object} argv
 * @return {function}
 */
function handler(argv: any) {
  const log = reporter.log(argv.reporter, 'import'),
    getStdin = require('get-stdin');

  log('Importing items...');
  return getStdin().then((str: any) => {
    if (!str) {
      throw new Error('No input provided. Pipe data via stdin or pass a file argument.');
    }

    return importItems(str, argv.url, {
      key: argv.key,
      concurrency: argv.concurrency,
      publish: argv.publish,
      yaml: argv.yaml
    });
  }).then((results: any) => {
    var logActionFn = reporter.logAction(argv.reporter, 'import');

    var pages: any;

    results.forEach((item: any) => {
      logActionFn(item);
      // catch people trying to import dispatches from yaml files
      if (item.type === 'error' && item.message === 'Cannot import dispatch from yaml') {
        reporter.logSummary(argv.reporter, 'import', () => ({ success: false, message: 'Unable to import' }))([item]);
        process.exit(1);
      }
    });

    pages = _.map(_.filter(results, (result: any) => result.type === 'success' && _.includes(result.message, 'pages')), (page: any) => `${page.message}.html`);

    reporter.logSummary(argv.reporter, 'import', (successes: any) => {
      if (successes && pages.length) {
        return { success: true, message: `Imported ${pluralize('page', pages.length, true)}\n${chalk.gray(pages.join('\n'))}` };
      } else if (successes) {
        return { success: true, message: `Imported ${pluralize('uri', successes, true)}` };
      } else {
        return { success: false, message: 'Imported 0 uris (´°ω°`)' };
      }
    })(results);
  });
}

export = {
  command: 'import [url]',
  describe: 'Import data into clay',
  aliases: ['importer', 'i'],
  builder,
  handler
};

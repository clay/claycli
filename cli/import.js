'use strict';
const _ = require('lodash'),
  pluralize = require('pluralize'),
  chalk = require('chalk'),
  options = require('./cli-options'),
  reporter = require('../lib/reporters'),
  importItems = require('../lib/cmd/import');

function builder(yargs) {
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
function handler(argv) {
  const log = reporter.log(argv.reporter, 'import');

  log('Importing items...');
  return importItems(process.stdin, argv.url, {
    key: argv.key,
    concurrency: argv.concurrency,
    publish: argv.publish,
    yaml: argv.yaml
  })
    .stopOnError((e) => {
      reporter.logSummary(argv.reporter, 'import', () => 'Unable to import')([{ type: 'error', message: e.message }]);
      process.exit(1);
    })
    .map(reporter.logAction(argv.reporter, 'import'))
    .toArray((results) => {
      const pages = _.map(_.filter(results, (result) => result.type === 'success' && _.includes(result.message, 'pages')), (page) => `${page.message}.html`);

      reporter.logSummary(argv.reporter, 'import', (successes) => {
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

module.exports = {
  command: 'import [url]',
  describe: 'Import data into clay',
  aliases: ['importer', 'i'],
  builder,
  handler
};

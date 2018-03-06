'use strict';
const _ = require('lodash'),
  pluralize = require('pluralize'),
  chalk = require('chalk'),
  options = require('./cli-options'),
  log = require('../lib/terminal-logger')('import'),
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
    .option('y', options.yaml);
}

/**
 * log fatal errors and exit with non-zero status
 * @param  {Error} e
 */
function fatalError(e) {
  log.status.error(`Unable to import:\n${chalk.gray(e.message)}`);
  process.exit(1);
}

/**
 * show progress as we import things
 * @param  {object} argv
 * @return {function}
 */
function handler(argv) {
  let spinner = log.spinner({
    text: 'Importing items',
    spinner: 'dots',
    color: 'magenta'
  });

  spinner.start();
  return importItems(process.stdin, argv.url, {
    key: argv.key,
    concurrency: argv.concurrency,
    publish: argv.publish,
    yaml: argv.yaml
  })
    .stopOnError(fatalError)
    .toArray((resolved) => {
      const successes = _.map(_.filter(resolved, (item) => item.result === 'success'), 'url'),
        pages = _.map(_.filter(successes, (s) => _.includes(s, 'pages')), (page) => `${page}.html`),
        errors = _.map(_.filter(resolved, (item) => item.result === 'error'), 'message');

      if (successes.length && pages.length) {
        spinner.succeed(`Imported ${pluralize('page', pages.length, true)}: \n${chalk.gray(pages.join('\n'))}`);
      } else if (successes.length) {
        spinner.succeed(`Imported ${pluralize('uri', successes.length, true)}: \n${chalk.gray(successes.join('\n'))}`);
      } else {
        spinner.fail('Imported 0 uris (´°ω°`)');
      }

      if (errors.length) {
        log.status.error(`Skipped ${pluralize('uri', errors.length, true)} due to errors: \n${chalk.gray(errors.join('\n'))}`);
      }
    });
}

module.exports = {
  command: 'import [url]',
  describe: 'Import data into clay',
  aliases: ['importer', 'i'],
  builder,
  handler
};

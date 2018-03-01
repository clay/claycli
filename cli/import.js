'use strict';
const _ = require('lodash'),
  pluralize = require('pluralize'),
  chalk = require('chalk'),
  getStdin = require('get-stdin'),
  options = require('./cli-options'),
  log = require('../lib/terminal-logger')('import'),
  config = require('../lib/cmd/config'),
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
    .option('V', options.verbose);
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
        errors = _.map(_.filter(resolved, (item) => item.result === 'error'), 'url');

      if (successes.length) {
        spinner.succeed(`Imported ${pluralize('uri', successes.length, true)}!`);
      } else {
        spinner.fail('Imported 0 uris (´°ω°`)');
      }

      if (errors.length) {
        log.status.error(`Skipped ${pluralize('uri', errors.length, true)} due to errors: \n${chalk.gray(errors.join('\n'))}`);
      }
    });


  // if (argv.url) { // lint url
  //   let spinner = log.spinner({
  //     text: 'Linting url',
  //     spinner: 'dots',
  //     color: 'magenta'
  //   });
  //
  //   spinner.start();
  //   return linter.lintUrl(argv.url).toArray((resolved) => {
  //     const missing = _.map(_.filter(resolved, (item) => item.result === 'error'), 'url');
  //
  //     if (missing.length) {
  //       spinner.fail(`Missing ${pluralize('reference', missing.length, true)}:` + chalk.gray(`\n${missing.join('\n')}`));
  //     } else {
  //       spinner.succeed(`All references exist! (checked ${pluralize('uri', resolved.length, true)})`);
  //     }
  //   });
  // } else { // lint schema from stdin
  //   let spinner = log.spinner({
  //     text: 'Linting schema',
  //     spinner: 'dots',
  //     color: 'blue'
  //   });
  //
  //   spinner.start();
  //   return getStdin().then((str) => {
  //     return linter.lintSchema(str).toArray((resolved) => {
  //       const errors = _.filter(resolved, (item) => item.result === 'error');
  //
  //       if (errors.length) {
  //         spinner.fail(`Schema has ${pluralize('error', errors.length, true)}:` + chalk.gray(`\n${errors.map((e) => e.message + (e.example ? ':\n' + e.example : '')).join('\n')}`));
  //       } else {
  //         spinner.succeed('Schema has no issues');
  //       }
  //     });
  //   });
  // }
}

module.exports = {
  command: 'import [url]',
  describe: 'Import data into clay',
  aliases: ['importer', 'i'],
  builder,
  handler
};

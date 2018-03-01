'use strict';
const _ = require('lodash'),
  pluralize = require('pluralize'),
  chalk = require('chalk'),
  getStdin = require('get-stdin'),
  options = require('./cli-options'),
  log = require('../lib/terminal-logger')('import'),
  importString = require('../lib/cmd/import');

function builder(yargs) {
  return yargs
    .usage('Usage: $0 import [url]')
    .example('$0 import --key prod domain.com < db_dump.clay', 'Import dispatch from stdin')
    .example('$0 import --key prod --publish domain.com < db_dump.clay', 'Import and publish page')
    .example('$0 import --key prod --yaml domain.com < bootstrap.yml', 'Import bootstrap from stdin')
    .option('c', options.concurrency);
}

function handler(argv) {
  if (argv.url) { // lint url
    let spinner = log.spinner({
      text: 'Linting url',
      spinner: 'dots',
      color: 'magenta'
    });

    spinner.start();
    return linter.lintUrl(argv.url).toArray((resolved) => {
      const missing = _.map(_.filter(resolved, (item) => item.result === 'error'), 'url');

      if (missing.length) {
        spinner.fail(`Missing ${pluralize('reference', missing.length, true)}:` + chalk.gray(`\n${missing.join('\n')}`));
      } else {
        spinner.succeed(`All references exist! (checked ${pluralize('uri', resolved.length, true)})`);
      }
    });
  } else { // lint schema from stdin
    let spinner = log.spinner({
      text: 'Linting schema',
      spinner: 'dots',
      color: 'blue'
    });

    spinner.start();
    return getStdin().then((str) => {
      return linter.lintSchema(str).toArray((resolved) => {
        const errors = _.filter(resolved, (item) => item.result === 'error');

        if (errors.length) {
          spinner.fail(`Schema has ${pluralize('error', errors.length, true)}:` + chalk.gray(`\n${errors.map((e) => e.message + (e.example ? ':\n' + e.example : '')).join('\n')}`));
        } else {
          spinner.succeed('Schema has no issues');
        }
      });
    });
  }
}

module.exports = {
  command: 'lint [url]',
  describe: 'Lint urls or schemas',
  aliases: ['linter', 'l'],
  builder,
  handler
};

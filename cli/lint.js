'use strict';
const _ = require('lodash'),
  pluralize = require('pluralize'),
  chalk = require('chalk'),
  getStdin = require('get-stdin'),
  options = require('./cli-options'),
  log = require('../lib/terminal-logger')('lint'),
  linter = require('../lib/cmd/lint');

function builder(yargs) {
  return yargs
    .usage('Usage: $0 lint [url]')
    .example('$0 lint domain.com/_components/foo', 'Lint component')
    .example('$0 lint domain.com/_pages/foo', 'Lint page')
    .example('$0 lint domain.com/some-slug', 'Lint public url')
    .example('$0 lint < path/to/schema.yml', 'Lint schema file')
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
        spinner.fail(`Missing ${pluralize('reference', missing.length, true)}:` + chalk.grey(`\n${missing.join('\n')}`));
      } else {
        spinner.succeed(`All references exist! (${pluralize('uri', resolved.length, true)})`);
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
          spinner.fail(`Schema has ${pluralize('error', errors.length, true)}:` + chalk.grey(`\n${errors.map((e) => e.message + ':\n' + e.example).join('\n')}`));
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

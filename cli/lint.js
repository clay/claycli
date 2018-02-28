'use strict';
const _ = require('lodash'),
  pluralize = require('pluralize'),
  chalk = require('chalk'),
  options = require('./cli-options'),
  log = require('../lib/terminal-logger')('lint'),
  linter = require('../lib/cmd/lint');

function builder(yargs) {
  return yargs
    .usage('Usage: $0 lint [url]')
    .example('$0 lint domain.com/_components/foo', 'Lint component')
    .example('$0 lint domain.com/_pages/foo', 'Lint page')
    .example('$0 lint domain.com/some-slug', 'Lint public url')
    .option('c', options.concurrency);
}

function handler(argv) {
  let spinner = log.spinner({
    text: 'Checking references',
    spinner: 'dots',
    color: 'magenta'
  });

  if (argv.url) {
    spinner.start();
    return linter.lintUrl(argv.url).toArray((resolved) => {
      const missing = _.map(_.filter(resolved, (item) => item.result === 'error'), 'url');

      if (missing.length) {
        spinner.fail(`Missing ${pluralize('reference', missing.length, true)}:` + chalk.grey(`\n${missing.join('\n')}`));
      } else {
        spinner.succeed(`All references exist! (${pluralize('uri', resolved.length, true)})`);
      }
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

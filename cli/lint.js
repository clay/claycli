'use strict';
const pluralize = require('pluralize'),
  getStdin = require('get-stdin'),
  options = require('./cli-options'),
  linter = require('../lib/cmd/lint'),
  reporter = require('../lib/reporters');

function builder(yargs) {
  return yargs
    .usage('Usage: $0 lint [url]')
    .example('$0 lint domain.com/_components/foo', 'Lint component')
    .example('$0 lint domain.com/_pages/foo', 'Lint page')
    .example('$0 lint domain.com/some-slug', 'Lint public url')
    .example('$0 lint < path/to/schema.yml', 'Lint schema file')
    .option('c', options.concurrency)
    .option('r', options.reporter);
}

function handler(argv) {
  const log = reporter.log(argv.reporter, 'lint');

  return getStdin().then((str) => {
    if (str) { // lint schema from stdin
      log('Linting schema...');
      return linter.lintSchema(str)
        // no dot logging of individual schema linting, since it's just a single dot
        .toArray(reporter.logSummary(argv.reporter, 'lint', (successes, errors) => {
          if (errors) {
            return { success: false, message: `Schema has ${pluralize('error', errors, true)}` };
          } else {
            return { success: true, message: 'Schema has no issues' };
          }
        }));
    } else { // lint url
      log('Linting url...');
      return linter.lintUrl(argv.url)
        .map(reporter.logAction(argv.reporter, 'lint'))
        .toArray(reporter.logSummary(argv.reporter, 'lint', (successes, errors) => {
          if (errors) {
            return { success: false, message: `Missing ${pluralize('reference', errors, true)}`};
          } else {
            return { success: true, message: `All references exist! (checked ${pluralize('uri', successes, true)})` };
          }
        }));
    }
  });
}

module.exports = {
  command: 'lint [url]',
  describe: 'Lint urls or schemas',
  aliases: ['linter', 'l'],
  builder,
  handler
};

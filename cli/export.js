'use strict';
const _ = require('lodash'),
  pluralize = require('pluralize'),
  h = require('highland'),
  yaml = require('js-yaml'),
  chalk = require('chalk'),
  getStdin = require('get-stdin'),
  options = require('./cli-options'),
  config = require('../lib/cmd/config'),
  rest = require('../lib/rest'),
  log = {},
  exporter = require('../lib/cmd/export');

function builder(yargs) {
  return yargs
    .usage('Usage: $0 export [url]')
    .example('$0 export --key prod domain.com > db_dump.clay', 'Export dispatches')
    .example('$0 export --key prod --layout domain.com > db_dump.clay', 'Export pages with layouts')
    .example('$0 export --key prod --yaml domain.com/_pages/foo > bootstrap.yml', 'Export bootstrap')
    .option('k', options.key)
    .option('s', options.size)
    .option('l', options.layout)
    .option('y', options.yaml);
}

/**
 * log fatal errors and exit with non-zero status
 * @param  {Error} e
 * @param {object} spinner
 */
function fatalError(e, spinner) {
  spinner.fail(`Unable to export:\n${e.message}`);
  process.exit(1);
}

/**
 * show progress as we export things
 * @param  {object} argv
 */
function handler(argv) {
  let spinner = log.spinner({
      text: 'Exporting items',
      spinner: 'dots',
      color: 'magenta'
    }),
    url = config.get('url', argv.url),
    stream;

  spinner.start();
  stream = rest.isElasticPrefix(url).flatMap((isPrefix) => {
    if (isPrefix) {
      return h(getStdin()
        .then(yaml.safeLoad)
        .then((query) => {
          return exporter.fromQuery(url, query, {
            key: argv.key,
            concurrency: argv.concurrency,
            size: argv.size,
            layout: argv.layout,
            yaml: argv.yaml
          });
        })
        .catch((e) => fatalError(e, spinner))).flatten();
    } else {
      return exporter.fromURL(url, {
        key: argv.key,
        concurrency: argv.concurrency,
        size: argv.size,
        layout: argv.layout,
        yaml: argv.yaml
      });
    }
  });

  stream
    .stopOnError((e) => fatalError(e, spinner))
    .map((res) => argv.yaml ? yaml.safeDump(res) : `${JSON.stringify(res)}\n`)
    .tap((str) => process.stdout.write(str))
    .errors((err, push) => {
      push(null, { result: 'error', url: err.url }); // every url that errors out should be captured
    })
    .toArray((resolved) => {
      const errors = _.map(_.filter(resolved, (item) => _.isObject(item) && item.result === 'error'), 'message'),
        thing = argv.yaml ? 'bootstrap' : 'dispatch';

      if (errors.length) {
        spinner.fail(`Exported 0 ${thing}s (´°ω°\`)`);
        log.status.error(`Skipped ${pluralize(thing, errors.length, true)} due to errors: \n${chalk.gray(errors.join('\n'))}`);
      } else {
        spinner.succeed(`Exported ${pluralize(thing, resolved.length, true)}!`);
      }
    });
}

module.exports = {
  command: 'export [url]',
  describe: 'Export data from clay',
  aliases: ['exporter', 'e'],
  builder,
  handler
};

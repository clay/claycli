'use strict';
const _ = require('lodash'),
  pluralize = require('pluralize'),
  h = require('highland'),
  yaml = require('js-yaml'),
  getStdin = require('get-stdin'),
  options = require('./cli-options'),
  config = require('../lib/cmd/config'),
  rest = require('../lib/rest'),
  reporter = require('../lib/reporters'),
  exporter = require('../lib/cmd/export'),
  prefixes = require('../lib/prefixes');

function builder(yargs) {
  return yargs
    .usage('Usage: $0 export [url]')
    .example('$0 export --key prod domain.com > db_dump.clay', 'Export dispatches')
    .example('$0 export --key prod --layout domain.com > db_dump.clay', 'Export pages with layouts')
    .example('$0 export --key prod --yaml domain.com/_pages/foo > bootstrap.yml', 'Export bootstrap')
    .option('k', options.key)
    .option('s', options.size)
    .option('l', options.layout)
    .option('y', options.yaml)
    .option('r', options.reporter);
}

/**
 * log fatal errors and exit with non-zero status
 * @param  {Error} e
 * @param {object} argv
 */
function fatalError(e, argv) {
  reporter.logSummary(argv.reporter, 'export', () => ({ success: false, message: 'Unable to export' }))([{ type: 'error', message: e.url, details: e.message }]);
  process.exit(1);
}

/**
 * show progress as we export things
 * @param  {object} argv
 */
function handler(argv) {
  const log = reporter.log(argv.reporter, 'export');

  let url = config.get('url', argv.url),
    isElasticPrefix, stream;

  log('Exporting items...');
  stream = rest.isElasticPrefix(url).flatMap((isPrefix) => {
    isElasticPrefix = isPrefix;
    // if we're pointed at an elastic prefix, run a query to fetch pages
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
        })).flatten();
    } else {
      // export a single url
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
    .stopOnError((e) => fatalError(e, argv))
    .map((res) => {
      const rootKey = Object.keys(res)[0], // could be unprefixed uri OR type of thing (if exporting a bootstrap)
        str = argv.yaml ? yaml.safeDump(res) : `${JSON.stringify(res)}\n`;

      process.stdout.write(str); // pipe stringified exported stuff to stdout
      if (argv.yaml) {
        return { type: 'success', message: _.tail(rootKey).join('') }; // e.g. components
      } else if (isElasticPrefix) {
        return { type: 'success', message: `${url}${rootKey}` }; // e.g. http://domain.com/_components/foo
      } else {
        return { type: 'success', message: `${prefixes.getFromUrl(url)}${rootKey}` }; // e.g. http://domain.com/_pages/foo
      }
    })
    .errors((err, push) => {
      push(null, { type: 'error', message: err.url, details: err.message }); // every url that errors out should be captured
    })
    .map(reporter.logAction(argv.reporter, 'export'))
    .toArray(reporter.logSummary(argv.reporter, 'export', (successes) => {
      const thing = argv.yaml ? 'bootstrap' : 'dispatch';

      if (successes) {
        return { success: true, message: `Exported ${pluralize(thing, successes, true)}` };
      } else {
        return { success: false, message: `Exported 0 ${thing}s (´°ω°\`)` };
      }
    }));
}

module.exports = {
  command: 'export [url]',
  describe: 'Export data from clay',
  aliases: ['exporter', 'e'],
  builder,
  handler
};

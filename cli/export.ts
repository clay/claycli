const _ = require('lodash'),
  pluralize = require('pluralize'),
  yaml = require('js-yaml'),
  getStdin = require('get-stdin'),
  options = require('./cli-options'),
  config = require('../lib/cmd/config'),
  rest = require('../lib/rest'),
  reporter = require('../lib/reporters'),
  exporter = require('../lib/cmd/export'),
  prefixes = require('../lib/prefixes');

function builder(yargs: any) {
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
function fatalError(e: any, argv: any) {
  reporter.logSummary(argv.reporter, 'export', () => ({ success: false, message: 'Unable to export' }))([{ type: 'error', message: e.url, details: e.message }]);
  process.exit(1);
}

/**
 * show progress as we export things
 * @param  {object} argv
 */
function handler(argv: any) {
  const log = reporter.log(argv.reporter, 'export');

  var url = config.get('url', argv.url),
    isElasticPrefix: any;

  if (!url) {
    fatalError({ url: 'URL is not defined!', message: 'Please specify a url to export from'}, argv);
  }

  log('Exporting items...');
  return rest.isElasticPrefix(url).then((isPrefix: any) => {
    isElasticPrefix = isPrefix;
    // if we're pointed at an elastic prefix, run a query to fetch pages
    if (isPrefix) {
      return getStdin()
        .then(yaml.load)
        .then((query: any) => {
          return exporter.fromQuery(url, query, {
            key: argv.key,
            concurrency: argv.concurrency,
            size: argv.size,
            layout: argv.layout,
            yaml: argv.yaml
          });
        });
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
  }).then((results: any) => {
    var logActionFn = reporter.logAction(argv.reporter, 'export'),
      actions;

    actions = results.map((res: any) => {
      var rootKey = Object.keys(res)[0],
        str = argv.yaml ? yaml.dump(res) : `${JSON.stringify(res)}\n`;

      process.stdout.write(str); // pipe stringified exported stuff to stdout
      if (argv.yaml) {
        return { type: 'success', message: _.tail(rootKey).join('') }; // e.g. components
      } else if (isElasticPrefix) {
        return { type: 'success', message: `${url}${rootKey}` }; // e.g. http://domain.com/_components/foo
      } else {
        return { type: 'success', message: `${prefixes.getFromUrl(url)}${rootKey}` }; // e.g. http://domain.com/_pages/foo
      }
    });
    actions.forEach(logActionFn);
    reporter.logSummary(argv.reporter, 'export', (successes: any) => {
      var thing = argv.yaml ? 'bootstrap' : 'dispatch';

      if (successes) {
        return { success: true, message: `Exported ${pluralize(thing, successes, true)}` };
      } else {
        return { success: false, message: `Exported 0 ${thing}s (´°ω°\`)` };
      }
    })(actions);
  }).catch((e: any) => fatalError(e, argv));
}

export = {
  command: 'export [url]',
  describe: 'Export data from clay',
  aliases: ['exporter', 'e'],
  builder,
  handler
};

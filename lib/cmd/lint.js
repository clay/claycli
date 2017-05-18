const _ = require('lodash'),
  bluebird = require('bluebird'),
  clayUtils = require('clay-utils'),
  getStdin = require('get-stdin'),
  options = require('../utils/shared-options'),
  config = require('../utils/config'),
  logger = require('../utils/logger'),
  clay = require('../io/input-clay'),
  rest = require('../utils/rest');

function lintComponent(url) {
  let dataSpinner;

  logger.debug(`GET ${url}`);
  dataSpinner = logger.startSpinner('Fetching component data...');
  return rest.get(url).then((data) => {
    const refs = clay.expandComponentReferences(data);

    let refsSpinner;

    logger.stopSpinner(dataSpinner);
    logger.debug(`Found ${refs.length} references:`, `\n${refs.join('\n')}`);
    refsSpinner = logger.startSpinner('Checking references...');
    return bluebird.all(_.map(refs, clay.checkReference)).then((resolved) => {
      const missing = _.compact(resolved);

      logger.stopSpinner(refsSpinner);
      if (missing.length) {
        logger.error(`Component is missing ${missing.length} references:`, `\n${missing.join('\n')}`);
      } else {
        logger.success('All references in this component exist!', `(${resolved.length})`);
      }
    });
  });
}

function builder(yargs) {
  return yargs
    .usage('Usage: $0 lint [url] (or --file)')
    .example('$0 lint domain.com/components/foo', 'lint foo data')
    .example('$0 lint -f components/foo', 'lint foo data, template, schema')
    .example('clay export -c domain.com/components/foo | clay lint', 'lint foo data from stdin')
    .option('f', options.file);
}

function handler(argv) {
  return getStdin().then((stdin) => {
    if (stdin && clayUtils.isComponent(stdin) || argv.url && clayUtils.isComponent(argv.url)) {
      return lintComponent(config.normalizeSite(stdin || argv.url));
    } else {
      logger.error('Please provide a component or file(s) to lint!');
    }
  });
}

module.exports = {
  command: 'lint [url]',
  describe: 'lint component data, schema, or template',
  aliases: ['l', 'linter'],
  builder,
  handler
};

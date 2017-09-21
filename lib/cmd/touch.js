const _ = require('lodash'),
  clayUtils = require('clay-utils'),
  pluralize = require('pluralize'),
  options = require('../utils/shared-options'),
  config = require('../utils/config'),
  logger = require('../utils/logger'),
  clay = require('../io/input-clay'),
  rest = require('../utils/rest'),
  getYargHeaders = require('../utils/headers').getYargHeaders;

/**
 *
 * @param {string} prefix
 * @param {string} name
 * @param {object} argv
 */
function runLogic(prefix, name, argv) {
  const concurrency = argv.concurrency,
    headers = getYargHeaders(argv),
    published = argv.published,
    processSpinner = logger.startSpinner('Processing...'),
    instancesStream = clay.getComponentInstances(prefix, name, {
      concurrency,
      headers,
      onlyPublished: published
    })
    .stopOnError((err) => {
      logger.stopSpinner(processSpinner);
      logger.error(`Error resolving instances of ${name}!`, err.message);
    });

  if (argv.n) {
    // dry run
    instancesStream.toArray((values) => {
      const instances = _.head(values);

      logger.stopSpinner(processSpinner);
      if (instances && instances.length) {
        logger.info(`This would run GET requests against ${pluralize('instance', instances.length, true)} of ${name}`);
      } else {
        logger.info(`Found no instances of ${name}`);
      }
    });
  } else {
    instancesStream.flatMap((instances) => {
      const urls = _.map(instances, config.normalizeSite);

      return rest.get(urls, {concurrency, headers}).stopOnError((err) => {
        logger.stopSpinner(processSpinner);
        logger.error(`Error resolving instance of ${name}!`, err.message);
      });
    }).toArray((resolved) => {
      logger.stopSpinner(processSpinner);
      logger.success(`Successfully ran GET ${pluralize('request', resolved.length)} against ${pluralize('instance', resolved.length, true)} of ${name}!`);
    });
  }
}

/**
 * add options and comments specific to `touch`
 * @param {object} yargs
 * @returns {object}
 */
function builder(yargs) {
  return yargs
    .usage('Usage: $0 touch <component>')
    .example('$0 touch domain.com/components/foo', 'GET all instances of foo')
    .example('$0 touch foo --site bar', 'GET all instances of foo on site bar')
    .option('s', options.site)
    .option('n', options.dryRun)
    .option('headers', options.headers)
    .option('published', options.published);
}

/**
 *
 * @param {object} argv
 * @returns {*}
 */
function handler(argv) {
  if (clayUtils.isComponent(argv.component)) {
    // component url passed in, get the number of instances and tell the user
    let url = config.normalizeSite(argv.component), // apply all the site normalization stuff
      prefix = url.substring(0, url.indexOf('/components')),
      name = clayUtils.getComponentName(url);

    return runLogic(prefix, name, argv);
  } else if (argv.component && config.getSite(argv.site)) {
    // there's a component and either a site (or the default site from CLAY_DEFAULT_SITE)
    let name = argv.component,
      prefix = config.getSite(argv.site);

    logger.debug(`Attempting to GET ${name} from ${prefix}`);
    // we're logging this because the site is assumed to be a url if it doesn't
    // match any site alias in .clayconfig (e.g. localhost, domain.com, etc)
    // if you accidentally forget to add your site alias, running this command in --verbose mode
    // will help you diagnose that issue
    return runLogic(prefix, name, argv);
  } else {
    logger.error('Please provide component uri OR component name and site!');
  }
}

module.exports = {
  command: 'touch <component>',
  describe: 'GET every instance of a component',
  aliases: ['t', 'get'],
  builder,
  handler
};

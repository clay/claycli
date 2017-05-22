const _ = require('lodash'),
  clayUtils = require('clay-utils'),
  inquirer = require('inquirer'),
  pluralize = require('pluralize'),
  options = require('../utils/shared-options'),
  config = require('../utils/config'),
  logger = require('../utils/logger'),
  clay = require('../io/input-clay'),
  rest = require('../utils/rest');

function getInstances(instances, name) {
  const processSpinner = logger.startSpinner('Running GET requests...');

  return Promise.all(_.map(instances, (uri) => {
    logger.debug(`GET ${uri}`);
    return rest.get(config.normalizeSite(uri));
  })).then(() => {
    logger.stopSpinner(processSpinner);
    logger.success(`GOT ${pluralize('instance', instances.length, true)} of ${name}!`);
  });
}

function runLogic(prefix, name, argv) {
  return clay.getComponentInstances(prefix, name).then((instances) => {
    if (argv.n) {
      // dry run
      logger.info(`This would run GET requests against ${pluralize('instance', instances.length, true)} of ${name}`);
    } else if (argv.force) {
      // force
      return getInstances(instances, name);
    } else if (instances.length) {
      return inquirer.prompt([{
        type: 'confirm',
        name: 'confirm',
        message: `Found ${pluralize('instance', instances.length, true)} of ${name}. Run GET ${pluralize('request', instances.length)} against ${instances.length > 1 ? 'them' : 'it'}?`,
        default: true
      }]).then((answers) => {
        if (answers.confirm) {
          return getInstances(instances, name);
        }
      });
    } else {
      logger.info(`Found no instances of ${name}`);
    }
  }).catch(() => {
    logger.warn(`Error resolving instances of ${name}!`);
  });
}

function builder(yargs) {
  return yargs
    .usage('Usage: $0 touch <component>')
    .example('$0 touch domain.com/components/foo', 'GET all instances of foo')
    .example('$0 touch foo --site bar', 'GET all instances of foo on site bar')
    .option('s', options.site)
    .option('n', options.dryRun)
    .option('force', options.force);
}

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

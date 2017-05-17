const _ = require('lodash'),
  clayUtils = require('clay-utils'),
  inquirer = require('inquirer'),
  options = require('../utils/shared-options'),
  config = require('../utils/config'),
  logger = require('../utils/logger'),
  clay = require('../io/input-clay'),
  rest = require('../utils/rest');

function getInstances(instances, name) {
  return Promise.all(_.map(instances, (uri) => {
    logger.debug(`GET ${uri}`);
    return rest.get(config.normalizeSite(uri));
  })).then(() => logger.log(`GOT ${instances.length} instances of ${name}!`));
}

function runLogic(prefix, name, argv) {
  return clay.getComponentInstances(prefix, name).then((instances) => {
    if (argv.n) {
      // dry run
      logger.log(`This would run GET requests against ${instances.length} instances`);
    } else if (argv.force) {
      // force
      return getInstances(instances, name);
    } else {
      return inquirer.prompt([{
        type: 'confirm',
        name: 'confirm',
        message: `Found ${instances.length} instances of ${name}. Run GET requests against them?`,
        default: false
      }]).then((answers) => {
        if (answers.confirm) {
          return getInstances(instances, name);
        }
      });
    }
  }).catch(() => {
    logger.warn(`No instances of ${name} found!`);
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
  logger.setLogLevel(argv.verbose);
  if (clayUtils.isComponent(argv.component)) {
    // component url passed in, get the number of instances and tell the user
    let url = config.normalizeSite(argv.component), // apply all the site normalization stuff
      prefix = url.substring(0, url.indexOf('/components')),
      name = clayUtils.getComponentName(url);

    return runLogic(prefix, name, argv);
  } else if (argv.component && config.getSite(argv.site)) {
    let name = argv.component,
      prefix = config.getSite(argv.site);

    logger.debug(`Attempting to GET ${name} from ${prefix}`);
    return runLogic(prefix, name, argv);
  } else {
    logger.fatal('Please provide component uri OR component name and site!');
  }
}

module.exports = {
  command: 'touch <component>',
  describe: 'GET every instance of a component',
  aliases: ['t', 'get'],
  builder,
  handler
};

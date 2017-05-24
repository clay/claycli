const _ = require('lodash'),
  bluebird = require('bluebird'),
  clayUtils = require('clay-utils'),
  getStdin = require('get-stdin'),
  chalk = require('chalk'),
  pluralize = require('pluralize'),
  h = require('highland'),
  options = require('../utils/shared-options'),
  config = require('../utils/config'),
  logger = require('../utils/logger'),
  clay = require('../io/input-clay'),
  files = require('../io/input-files'),
  rest = require('../utils/rest');

/**
 * lint components via url
 * todo: support pages, not just component instances
 * @param  {string} url
 * @param {boolean} isRecursive
 * @return {Promise}
 */
function lintURL(url, isRecursive) {
  let dataSpinner;

  logger.debug(`GET ${url}`);
  dataSpinner = logger.startSpinner('Fetching component data...');
  return rest.get(url).then((data) => {
    const refs = clay.listComponentReferences(data);

    let refsSpinner, promises;

    logger.stopSpinner(dataSpinner);
    logger.debug(`Found ${pluralize('reference', refs.length, true)}:`, `\n${refs.join('\n')}`);
    refsSpinner = logger.startSpinner('Checking references...');

    if (isRecursive) {
      promises = bluebird.reduce(refs, clay.recursivelyCheckReferences, []);
    } else {
      promises = bluebird.all(_.map(refs, clay.checkReference));
    }

    return promises.then((resolved) => {
      const missing = _.compact(resolved);

      logger.stopSpinner(refsSpinner);
      if (missing.length) {
        logger.error(`Component is missing ${pluralize('reference', missing.length, true)}:`, `\n${missing.join('\n')}`);
      } else {
        logger.success('All references in this component exist!', `(${pluralize('uri', resolved.length, true)})`);
      }
    });
  });
}

/**
 * format missing refs as:
 * uri:
 * ref1
 * ref2
 * ref3
 * @param  {object} obj
 * @return {string}
 */
function formatMissing(obj) {
  return _.reduce(obj, (str, val, key) => {
    return str + chalk.underline(key) + ':\n' + Object.keys(val).map((ref) => `- ${ref}`).join('\n') + '\n';
  }, '\n');
}

/**
 * lint files and directories
 * @param  {string} filepath
 * @param {boolean} isRecursive
 */
function lintFile(filepath, isRecursive) {
  let bootstrapLength = 0,
    schemaLength = 0,
    fileLintSpinner, fileStream, bootstrapStream, schemaStream, bootstrapIssues, schemaIssues;

  logger.debug(`Attempting to lint ${filepath}`);
  fileLintSpinner = logger.startSpinner('Opening files...');
  fileStream = files.get(filepath, isRecursive);

  // fork the bootstraps and schemas
  bootstrapStream = fileStream.fork().filter(files.omitSchemas);
  schemaStream = fileStream.fork().reject(files.omitSchemas);

  // lint bootstraps, creating a stream with a big issues object
  // note: we need to collect data into a big object because reference checking
  // requires us to look into that object
  bootstrapIssues = bootstrapStream.collect().map((bootstraps) => {
    bootstrapLength = bootstraps.length;
    return _.reduce(bootstraps, (issues, chunk) => {
      const uri = Object.keys(chunk)[0],
        data = chunk[uri],
        refs = clay.listComponentReferences(data);

      return _.reduce(refs, (result, ref) => {
        if (!_.find(bootstraps, (bootstrap) => Object.keys(bootstrap)[0] === ref)) {
          result[uri] = result[uri] || {};
          _.assign(result[uri], { [ref]: true });
        }
        return result;
      }, issues);
    }, {});
  });

  // lint schemas, creating a stream of filenames (of schemas that fail the linting)
  schemaIssues = schemaStream.map((chunk) => {
    const filename = Object.keys(chunk)[0],
      schema = chunk[filename];

    schemaLength++;
    if (!schema._description) {
      return filename;
    } else {
      return false; // gets compacted out
    }
  });

  // merge the streams and display results to the end user
  h([bootstrapIssues, schemaIssues]).merge().toArray((items) => {
    const schemasWithIssues = _.filter(items, _.isString),
      bootstrapsWithIssues = _.find(items, _.isObject);

    // display results
    logger.stopSpinner(fileLintSpinner);

    // data linting results
    if (_.size(bootstrapsWithIssues)) {
      logger.error(`${pluralize('component', _.size(bootstrapsWithIssues), true)} ${_.size(bootstrapsWithIssues) > 1 ? 'are' : 'is'} missing references!`, formatMissing(bootstrapsWithIssues));
    } else {
      logger.success('All component references exist!', `(${pluralize('uri', bootstrapLength, true)})`);
    }

    // schema linting results
    if (schemasWithIssues.length) {
      logger.error(`${pluralize('schema', schemasWithIssues.length, true)} ${schemasWithIssues.length > 1 ? 'are' : 'is'} missing _description:\n`, _.map(schemasWithIssues, (filename) => `- ${filename}`).join('\n') + '\n');
    } else if (schemaLength) {
      logger.success('All schema _descriptions exist!', `(${pluralize('schema', schemaLength, true)})`);
    }
  });
}

function builder(yargs) {
  return yargs
    .usage('Usage: $0 lint [url] (or --file)')
    .example('$0 lint domain.com/components/foo', 'lint foo data')
    .example('$0 lint -f components/foo', 'lint foo data and schema')
    .example('clay export -c domain.com/components/foo | clay lint', 'lint foo data from stdin')
    .example('$0 lint domain.com/components/layout -r', 'lint ALL components in layout')
    .option('f', options.file)
    .option('r', options.recursive);
}

function handler(argv) {
  return getStdin().then((stdin) => {
    // note: this only allows component uri strings from stdin currently
    if (stdin && clayUtils.isComponent(stdin) || argv.url && clayUtils.isComponent(argv.url)) {
      return lintURL(config.normalizeSite(stdin || argv.url), argv.recursive);
    } else if (argv.file) {
      return lintFile(config.getFile(argv.file), argv.recursive);
    } else {
      logger.error('Please provide a component or file(s) to lint!');
    }
  });
}

module.exports = {
  command: 'lint [url]',
  describe: 'lint component data and schema',
  aliases: ['l', 'linter'],
  builder,
  handler
};

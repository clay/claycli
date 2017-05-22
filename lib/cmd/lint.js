const _ = require('lodash'),
  bluebird = require('bluebird'),
  clayUtils = require('clay-utils'),
  getStdin = require('get-stdin'),
  chalk = require('chalk'),
  pluralize = require('pluralize'),
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
 * @return {Promise}
 */
function lintFile(filepath, isRecursive) {
  let fileLintSpinner;

  logger.debug(`Attempting to lint ${filepath}`);
  fileLintSpinner = logger.startSpinner('Opening files...');
  return files.get(filepath, isRecursive).then((obj) => {
    // lint all yaml and json bootstraps
    const dataFiles = _.assign({}, obj.bootstraps, obj.json);

    let missing = {};

    _.forOwn(dataFiles, (data, uri) => {
      const refs = clay.listComponentReferences(data);

      _.assign(missing, _.reduce(refs, (result, ref) => {
        if (!dataFiles[ref]) {
          result[uri] = result[uri] || {};
          _.assign(result[uri], { [ref]: true });
        }
        return result;
      }, {}));
    });
    logger.stopSpinner(fileLintSpinner);
    if (_.size(missing)) {
      logger.error(`${pluralize('component', _.size(missing), true)} ${_.size(missing) > 1 ? 'are' : 'is'} missing references!`, formatMissing(missing));
    } else {
      logger.success('All component references exist!', `(${pluralize('uri', _.size(dataFiles), true)})`);
    }
  }).catch((e) => {
    logger.error(e.message, filepath);
  });
}

function builder(yargs) {
  return yargs
    .usage('Usage: $0 lint [url] (or --file)')
    .example('$0 lint domain.com/components/foo', 'lint foo data')
    .example('$0 lint -f components/foo', 'lint foo data, template, schema')
    .example('clay export -c domain.com/components/foo | clay lint', 'lint foo data from stdin')
    .example('$0 lint domain.com/components/layout -r', 'lint ALL components in layout')
    .option('f', options.file)
    .option('r', options.recursive);
}

function handler(argv) {
  return getStdin().then((stdin) => {
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
  describe: 'lint component data, schema, or template',
  aliases: ['l', 'linter'],
  builder,
  handler
};

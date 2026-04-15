'use strict';
const chalk = require('chalk'),
  options = require('./cli-options'),
  tools = require('../lib/cmd/dev-tools');

/**
 * Configure `clay restore` CLI arguments.
 * @param {object} yargs
 * @returns {object}
 */
function builder(yargs) {
  return yargs
    .usage('Usage: $0 restore <url>')
    .example('$0 restore https://domain.com --file homepage-backup.clay -k qa', 'Restore snapshot to target site')
    .option('k', options.key)
    .option('file', {
      alias: 'f',
      describe: 'snapshot file created by clay backup',
      type: 'string',
      demandOption: true
    })
    .option('publish', {
      describe: 'publish restored items',
      type: 'boolean'
    })
    .option('json', {
      describe: 'output machine-readable json',
      type: 'boolean'
    });
}

/**
 * Restore a snapshot into a target environment.
 * @param {object} argv
 * @returns {Promise<void>}
 */
async function handler(argv) {
  const key = tools.getKey(argv.key),
    result = await tools.restoreSnapshot(argv.file, argv.url, key, argv.publish);

  if (argv.json) {
    console.log(JSON.stringify(result, null, 2)); // eslint-disable-line no-console
    return;
  }

  console.log(chalk.green(`Restored ${result.successes} item(s)`)); // eslint-disable-line no-console
  if (result.errors.length) {
    console.log(chalk.red(`Errors: ${result.errors.length}`)); // eslint-disable-line no-console
    result.errors.forEach((err) => console.log(`- ${err.message}`)); // eslint-disable-line no-console
  }
}

module.exports = {
  command: 'restore <url>',
  describe: 'Restore a dispatch snapshot to a target site',
  aliases: ['load'],
  builder,
  handler
};

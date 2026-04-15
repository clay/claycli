'use strict';
const chalk = require('chalk'),
  options = require('./cli-options'),
  rescue = require('../lib/cmd/rescue');

/**
 * Configure `clay rescue` CLI arguments.
 * @param {object} yargs
 * @returns {object}
 */
function builder(yargs) {
  return yargs
    .usage('Usage: $0 rescue <url>')
    .example('$0 rescue https://domain.com/_pages/homepage -k qa', 'Backup + diagnose + fix plan')
    .example('$0 rescue https://domain.com/_pages/homepage -k qa --apply --publish', 'Backup + diagnose + apply safe fix + publish')
    .option('k', options.key)
    .option('c', options.concurrency)
    .option('output', {
      alias: 'o',
      describe: 'backup output file path',
      type: 'string'
    })
    .option('apply', {
      describe: 'apply safe fix (default dry-run)',
      type: 'boolean'
    })
    .option('publish', {
      describe: 'publish page after apply',
      type: 'boolean'
    })
    .option('json', {
      describe: 'output machine-readable json',
      type: 'boolean'
    });
}

/**
 * Run backup + diagnose + safe-fix workflow and render output.
 * @param {object} argv
 * @returns {Promise<void>}
 */
async function handler(argv) {
  const result = await rescue.run(argv.url, argv);

  if (argv.json) {
    console.log(JSON.stringify(result, null, 2)); // eslint-disable-line no-console
    return;
  }

  console.log(chalk.cyan(`Rescue report for ${result.backup.resolved.pageUri}`)); // eslint-disable-line no-console
  console.log(`Backup: ${result.backup.filePath}`); // eslint-disable-line no-console
  console.log(`Refs scanned: ${result.diagnosis.refsCount}`); // eslint-disable-line no-console
  console.log(`Missing refs: ${result.diagnosis.missingRefs.length}`); // eslint-disable-line no-console
  console.log(`Fix changes: ${result.fixResult.changes.length}`); // eslint-disable-line no-console
  if (result.fixResult.dryRun) {
    console.log(chalk.yellow('Dry-run only. Re-run with --apply to mutate data.')); // eslint-disable-line no-console
  } else {
    console.log(chalk.green('Applied safe fixes.')); // eslint-disable-line no-console
  }
}

module.exports = {
  command: 'rescue <url>',
  describe: 'Backup + diagnose + safe-fix workflow for broken pages',
  aliases: ['heal'],
  builder,
  handler
};

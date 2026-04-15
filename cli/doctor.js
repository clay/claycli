'use strict';
const chalk = require('chalk'),
  options = require('./cli-options'),
  doctor = require('../lib/cmd/doctor');

/**
 * Configure `clay doctor` CLI arguments.
 * @param {object} yargs
 * @returns {object}
 */
function builder(yargs) {
  return yargs
    .usage('Usage: $0 doctor <url>')
    .example('$0 doctor https://domain.com/_pages/homepage -k qa', 'Diagnose page refs')
    .example('$0 doctor https://domain.com/_pages/homepage --fix --apply -k qa', 'Prune missing refs and apply')
    .option('k', options.key)
    .option('c', options.concurrency)
    .option('fix', {
      describe: 'run safe auto-fix plan for missing refs',
      type: 'boolean'
    })
    .option('apply', {
      describe: 'apply mutations (default is dry-run)',
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
 * Run diagnosis or safe-fix mode and render output.
 * @param {object} argv
 * @returns {Promise<void>}
 */
async function handler(argv) {
  if (argv.fix) {
    const result = await doctor.safeFix(argv.url, {
      key: argv.key,
      apply: argv.apply,
      publish: argv.publish,
      concurrency: argv.concurrency
    });

    if (argv.json) {
      console.log(JSON.stringify(result, null, 2)); // eslint-disable-line no-console
      return;
    }

    console.log(chalk.cyan(`Doctor ${result.dryRun ? 'plan' : 'apply'} for ${result.resolved.pageUri}`)); // eslint-disable-line no-console
    console.log(`Missing refs: ${result.missingRefs.length}`); // eslint-disable-line no-console
    console.log(`Changes: ${result.changes.length}`); // eslint-disable-line no-console
    if (result.changes.length) {
      result.changes.forEach((change) => console.log(`- ${change.action} ${change.path}`)); // eslint-disable-line no-console
    }
    return;
  }

  const diagnosis = await doctor.diagnose(argv.url, {
    key: argv.key,
    concurrency: argv.concurrency
  });

  if (argv.json) {
    console.log(JSON.stringify(diagnosis, null, 2)); // eslint-disable-line no-console
    return;
  }

  console.log(chalk.cyan(`Doctor report for ${diagnosis.resolved.pageUri}`)); // eslint-disable-line no-console
  console.log(`Refs scanned: ${diagnosis.refsCount}`); // eslint-disable-line no-console
  console.log(`Missing refs: ${diagnosis.missingRefs.length}`); // eslint-disable-line no-console
  diagnosis.missingRefs.forEach((ref) => console.log(`- ${ref}`)); // eslint-disable-line no-console

  if (diagnosis.lintErrors.length) {
    console.log(chalk.yellow('\nLint errors:')); // eslint-disable-line no-console
    diagnosis.lintErrors.forEach((msg) => console.log(`- ${msg}`)); // eslint-disable-line no-console
  }
}

module.exports = {
  command: 'doctor <url>',
  describe: 'Diagnose and safely repair broken refs on pages',
  aliases: ['doc'],
  builder,
  handler
};

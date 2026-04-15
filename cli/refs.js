'use strict';
const _ = require('lodash'),
  chalk = require('chalk'),
  options = require('./cli-options'),
  refs = require('../lib/cmd/refs');

function builder(yargs) {
  return yargs
    .usage('Usage: $0 refs <url-or-prefix>')
    .example('$0 refs https://domain.com/_pages/homepage --action prune -k qa', 'Prune missing refs')
    .example('$0 refs https://domain.com/_pages/homepage --action replace --ref /_components/a --to /_components/b --apply -k qa', 'Replace refs in page')
    .example('$0 refs stg --action where-used --ref /_components/foo/instances/bar -k qa', 'Find pages using ref')
    .example('$0 refs stg --action reset --ref /_components/foo/instances/bar --apply -k qa', 'Reset a broken component instance')
    .option('k', options.key)
    .option('c', options.concurrency)
    .option('action', {
      describe: 'refs operation',
      choices: ['prune', 'replace', 'reset', 'where-used'],
      demandOption: true
    })
    .option('ref', {
      describe: 'reference uri for replace/reset/where-used',
      type: 'string'
    })
    .option('to', {
      describe: 'replacement ref uri, or {} behavior via literal "{}"',
      type: 'string'
    })
    .option('apply', {
      describe: 'apply mutation operations (default dry-run)',
      type: 'boolean'
    })
    .option('publish', {
      describe: 'publish page after apply',
      type: 'boolean'
    })
    .option('where-used', {
      describe: 'when resetting, also return pages that reference this ref',
      type: 'boolean'
    })
    .option('size', {
      describe: 'max search hits for where-used',
      type: 'number',
      default: 1000
    })
    .option('json', {
      describe: 'output machine-readable json',
      type: 'boolean'
    });
}

async function handler(argv) {
  const result = await runAction(argv);

  if (argv.json) {
    console.log(JSON.stringify(result, null, 2)); // eslint-disable-line no-console
    return;
  }

  console.log(chalk.cyan(`refs:${result.action}`)); // eslint-disable-line no-console
  if (result.missingRefs) console.log(`Missing refs: ${result.missingRefs.length}`); // eslint-disable-line no-console
  if (result.changes) console.log(`Changes: ${result.changes.length}`); // eslint-disable-line no-console
  if (result.pages) {
    console.log(`Pages: ${result.pages.length}`); // eslint-disable-line no-console
    result.pages.forEach((page) => console.log(`- ${page}`)); // eslint-disable-line no-console
  }
  if (result.applied) console.log(chalk.green('Changes applied')); // eslint-disable-line no-console
  else if (_.has(result, 'dryRun') && result.dryRun) console.log(chalk.yellow('Dry-run only. Re-run with --apply to mutate data.')); // eslint-disable-line no-console
}

function validateArgs(argv) {
  if (argv.action === 'replace' && (!argv.ref || !argv.to)) {
    throw new Error('--ref and --to are required for --action replace');
  }

  if ((argv.action === 'reset' || argv.action === 'where-used') && !argv.ref) {
    throw new Error('--ref is required for this action');
  }
}

function runAction(argv) {
  validateArgs(argv);

  switch (argv.action) {
    case 'prune': return refs.prune(argv.url, argv);
    case 'replace': return refs.replace(argv.url, argv.ref, argv.to, argv);
    case 'reset': return refs.reset(argv.ref, argv.url, argv);
    default: return refs.whereUsed(argv.url, argv.ref, argv);
  }
}

module.exports = {
  command: 'refs <url>',
  describe: 'Prune, replace, reset, and locate refs',
  aliases: ['ref'],
  builder,
  handler
};

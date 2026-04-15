'use strict';
const chalk = require('chalk'),
  tools = require('../lib/cmd/dev-tools');

function builder(yargs) {
  return yargs
    .usage('Usage: $0 backup <url>')
    .example('$0 backup https://domain.com/_pages/homepage --output homepage-backup.clay', 'Create page snapshot')
    .option('output', {
      alias: 'o',
      describe: 'output snapshot file path',
      type: 'string'
    })
    .option('json', {
      describe: 'output machine-readable json',
      type: 'boolean'
    });
}

async function handler(argv) {
  const result = await tools.backupPage(argv.url, argv.output);

  if (argv.json) {
    console.log(JSON.stringify(result, null, 2)); // eslint-disable-line no-console
    return;
  }

  console.log(chalk.green(`Backup saved: ${result.filePath}`)); // eslint-disable-line no-console
  console.log(`Dispatches: ${result.dispatchCount}`); // eslint-disable-line no-console
  console.log(`Page: ${result.resolved.pageUri}`); // eslint-disable-line no-console
}

module.exports = {
  command: 'backup <url>',
  describe: 'Snapshot a page and its layout dispatches',
  aliases: ['snap'],
  builder,
  handler
};

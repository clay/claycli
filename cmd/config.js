const inquirer = require('inquirer'),
  _ = require('lodash');

function builder(yargs) {
  return yargs
    .usage('Usage $0 config <alias> [value]')
    .example('$0 key.local', 'View local api key')
    .example('$0 site.local localhost:3001', 'Set localhost site alias');
}

function handler(argv) {
  console.log(argv)
}

module.exports = {
  command: 'config',
  describe: 'View or set config variables',
  builder,
  handler
};

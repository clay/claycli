'use strict';
const pluralize = require('pluralize'),
  compile = require('../../lib/cmd/compile'),

  options = require('../cli-options'),
  reporter = require('../../lib/reporters'),
  helpers = require('../../lib/compilation-helpers');

function builder(yargs) {
  return yargs
    .usage('Usage: $0 custom-tasks')
    .example('$0 custom-tasks', 'run custom tasks defined in the claycli.config.js file `customTasks` property')
    .option('r', options.reporter);
}

function handler(argv) {
  compile.customTasks({
    watch: argv.watch,
    minify: argv.minify,
    inlined: argv.inlined,
    linked: argv.linked
  });
}

module.exports = {
  command: 'custom-tasks',
  describe: 'Run any custom tasks. Each task will be wrapped by Gulp',
  builder,
  handler
};

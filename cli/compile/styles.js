'use strict';
const _ = require('lodash'),
  chalk = require('chalk'),
  pluralize = require('pluralize'),
  compile = require('../../lib/cmd/compile'),
  options = require('../cli-options'),
  reporter = require('../../lib/reporters'),
  helpers = require('../../lib/compilation-helpers');

function builder(yargs) {
  return yargs
    .usage('Usage: $0 styles')
    .example('$0 styles', 'compile css files with postcss')
    .example('$0 styles --watch', 'compile and watch css files')
    .option('w', options.watch)
    .option('m', options.minify)
    .option('p', options.plugins)
    .option('r', options.reporter);
}

function handler(argv) {
  const t1 = Date.now(),
    plugins = _.map(argv.plugins, (pluginName) => {
      try {
        return require(pluginName)();
      } catch (e) {
        console.error(`${chalk.red('Error: Cannot init plugin "' + pluginName + '"')}\n${chalk.grey(e.message)}`);
      }
    }),
    compiled = compile.styles({
      watch: argv.watch,
      minify: argv.minify,
      plugins
    });

  return compiled.build
    .map(reporter.logAction(argv.reporter, 'styles'))
    .toArray((results) => {
      const t2 = Date.now();

      reporter.logSummary(argv.reporter, 'styles', (successes) => {
        let message = `Compiled ${argv.minify ? 'and minified ' : '' }${pluralize('css file', successes, true)} in ${helpers.time(t2, t1)}`;

        if (compiled.watch) {
          message += '\nWatching for changes...';
        }
        return { success: true, message };
      })(results);

      if (compiled.watch) {
        compiled.watch.on('raw', helpers.debouncedWatcher);
      }
    });
}

module.exports = {
  command: 'styles',
  describe: 'Compile styles',
  builder,
  handler
};

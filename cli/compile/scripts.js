'use strict';
const pluralize = require('pluralize'),
  compile = require('../../lib/cmd/compile'),
  options = require('../cli-options'),
  reporter = require('../../lib/reporters'),
  helpers = require('../../lib/compilation-helpers');

function builder(yargs) {
  return yargs
    .usage('Usage: $0 scripts')
    .example('$0 scripts', 'compile js files')
    .example('$0 scripts --watch', 'compile and watch js files')
    .option('w', options.watch)
    .option('m', options.minify)
    .option('g', options.globs)
    .option('r', options.reporter);
}

function handler(argv) {
  const t1 = Date.now(),
    compiled = compile.scripts({
      watch: argv.watch,
      minify: argv.minify,
      globs: argv.globs
    });

  return compiled.build
    .map(reporter.logAction(argv.reporter, 'scripts'))
    .toArray((results) => {
      const t2 = Date.now();

      reporter.logSummary(argv.reporter, 'scripts', (successes) => {
        let message = `Compiled ${argv.minify ? 'and minified ' : '' }${pluralize('script', successes, true)} in ${helpers.time(t2, t1)}`;

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
  command: 'scripts',
  describe: 'Compile scripts',
  builder,
  handler
};

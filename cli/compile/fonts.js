'use strict';
const pluralize = require('pluralize'),
  compile = require('../../lib/cmd/compile'),
  options = require('../cli-options'),
  reporter = require('../../lib/reporters'),
  helpers = require('../../lib/compilation-helpers');

function builder(yargs) {
  return yargs
    .usage('Usage: $0 fonts')
    .example('$0 fonts', 'compile linked fonts')
    .example('$0 fonts --watch', 'compile and watch linked fonts')
    .example('$0 fonts --inlined --linked', 'compile inlined and linked fonts')
    .option('w', options.watch)
    .option('m', options.minify)
    .option('i', options.inlined)
    .option('l', options.linked)
    .option('r', options.reporter);
}

function handler(argv) {
  const t1 = Date.now(),
    compiled = compile.fonts({
      watch: argv.watch,
      minify: argv.minify,
      inlined: argv.inlined,
      linked: argv.linked
    });

  return compiled.build
    .map(reporter.logAction(argv.reporter, 'fonts'))
    .toArray((results) => {
      const t2 = Date.now();

      reporter.logSummary(argv.reporter, 'fonts', (successes) => {
        let message = `Compiled ${pluralize('font', successes, true)} in ${helpers.time(t2, t1)}`;

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
  command: 'fonts',
  describe: 'Compile fonts',
  builder,
  handler
};

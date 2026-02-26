const pluralize = require('pluralize'),
  compile = require('../../lib/cmd/compile'),
  options = require('../cli-options'),
  reporter = require('../../lib/reporters'),
  helpers = require('../../lib/compilation-helpers');

function builder(yargs: any) {
  return yargs
    .usage('Usage: $0 templates')
    .example('$0 templates', 'compile handlebars templates')
    .example('$0 templates --watch', 'compile and watch handlebars templates')
    .option('w', options.watch)
    .option('m', options.minify)
    .option('r', options.reporter);
}

function handler(argv: any) {
  const t1 = Date.now(),
    compiled = compile.templates({
      watch: argv.watch,
      minify: argv.minify
    });

  return compiled.build
    .map(reporter.logAction(argv.reporter, 'templates'))
    .toArray((results: any) => {
      const t2 = Date.now();

      reporter.logSummary(argv.reporter, 'templates', (successes: any) => {
        let message = `Compiled ${argv.minify ? 'and minified ' : '' }${pluralize('template', successes, true)} in ${helpers.time(t2, t1)}`;

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

export = {
  command: 'templates',
  describe: 'Compile templates',
  builder,
  handler
};

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
    .usage('Usage: $0 media')
    .example('$0 media', 'compile component, layout, and styleguide media files')
    .example('$0 media --watch', 'compile and watch media files')
    .option('w', options.watch)
    .option('r', options.reporter);
}

function handler(argv) {
  const t1 = Date.now(),
    compiled = compile.media({ watch: argv.watch });

  return compiled.build
    .map(reporter.logAction(argv.reporter, 'media'))
    .toArray((results) => {
      const t2 = Date.now();

      reporter.logSummary(argv.reporter, 'media', (successes) => {
        let message = `Compiled ${pluralize('file', successes, true)} in ${helpers.time(t2, t1)}`;

        if (compiled.watch) {
          message += '\nWatching for changes...';
        }
        return { success: true, message };
      })(results);

      if (compiled.watch) {
        compiled.watch.on('raw', (e, filepath) => {
          if (!_.includes(filepath, '.DS_Store')) {
            console.log(chalk.green('✓ ') + chalk.grey(filepath.replace(process.cwd(), '')));
          }
        });
      }
    });
}

module.exports = {
  command: 'media',
  describe: 'Compile media',
  aliases: ['f'],
  builder,
  handler
};

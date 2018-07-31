'use strict';
const h = require('highland'),
  _ = require('lodash'),
  chalk = require('chalk'),
  pluralize = require('pluralize'),
  compile = require('../../lib/cmd/compile'),
  options = require('../cli-options'),
  reporter = require('../../lib/reporters'),
  helpers = require('../../lib/compilation-helpers');

function builder(yargs) {
  return yargs
    .usage('Usage: $0 compile [asset type]')
    .command(require('./fonts'))
    .command(require('./media'))
    .example('$0 compile', 'compile all assets')
    .example('$0 compile --watch', 'compile and watch all assets')
    .option('w', options.watch)
    .option('m', options.minify)
    // font-specific options
    .option('i', options.inlined)
    .option('l', options.linked)
    // reporter option
    .option('r', options.reporter);
}

function handler(argv) {
  const t1 = Date.now(),
    fonts = compile.fonts({
      watch: argv.watch,
      minify: argv.minify,
      inlined: argv.inlined,
      linked: argv.linked
    }),
    media = compile.media({ watch: argv.watch }),
    tasks = [fonts, media],
    builders = _.map(tasks, (task) => task.build),
    watchers = _.map(tasks, (task) => task.watch),
    isWatching = !!watchers[0];

  return h(builders)
    .merge()
    .map(reporter.logAction(argv.reporter, 'compile'))
    .toArray((results) => {
      const t2 = Date.now();

      reporter.logSummary(argv.reporter, 'compile', (successes) => {
        let message = `Compiled ${pluralize('file', successes, true)} in ${helpers.time(t2, t1)}`;

        if (isWatching) {
          message += '\nWatching for changes...';
        }
        return { success: true, message };
      })(results);

      if (isWatching) {
        _.each(watchers, (watcher) => {
          watcher.on('raw', (e, filepath) => {
            if (!_.includes(filepath, '.DS_Store')) {
              console.log(chalk.green('✓ ') + chalk.grey(filepath.replace(process.cwd(), '')));
            }
          });
        });
      }
    });
}

module.exports = {
  command: 'compile [asset type]',
  describe: 'Compile fonts, media, styles, scripts, and templates',
  aliases: ['compiler', 'c'],
  builder,
  handler
};

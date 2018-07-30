'use strict';
const h = require('highland'),
  _ = require('lodash'),
  chalk = require('chalk'),
  format = require('date-fns/format'),
  pluralize = require('pluralize'),
  compile = require('../../lib/cmd/compile'),
  options = require('../cli-options'),
  reporter = require('../../lib/reporters');

function builder(yargs) {
  return yargs
    .usage('Usage: $0 media')
    .example('$0 media', 'compile component, layout, and styleguide media files')
    .example('$0 media --watch', 'compile and watch media files')
    .option('w', options.watch)
    .option('r', options.reporter);
}

// todo: move this to a helpers util
function time(t2, t1) {
  const diff = t2 - t1;

  if (diff > 6000) {
    // more than a minute (6000ms)
    return format(new Date(diff), 'm[m] s.SS[s]');
  } else {
    // less than a minute
    return format(new Date(diff), 's.SS[s]');
  }
}

function handler(argv) {
  const t1 = Date.now(),
    compiled = compile.media({
      watch: argv.watch,
      minify: argv.minify,
      inlined: argv.inlined,
      linked: argv.linked
    });

  return h(compiled.build)
    .map(reporter.logAction(argv.reporter, 'media'))
    .toArray((results) => {
      const compiledFiles = _.map(_.filter(results, (result) => result.type === 'success'), (result) => result.message),
        t2 = Date.now();

      reporter.logSummary(argv.reporter, 'media', (successes) => {
        let message = `Compiled ${pluralize('file', successes, true)} in ${time(t2, t1)}`;

        if (successes) {
          message += `\n${chalk.gray(compiledFiles.join('\n'))}`;
        }

        if (compiled.watch) {
          message += '\nWatching for changes...';
        }
        return { success: true, message };
      })(results);

      if (compiled.watch) {
        compiled.watch.on('raw', (e, filepath) => {
          if (!_.includes(filepath, '.DS_Store')) {
            console.log(chalk.green('✓') + chalk.grey(filepath.replace(process.cwd(), '')));
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

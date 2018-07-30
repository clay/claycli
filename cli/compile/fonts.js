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
    compiled = compile.fonts({
      watch: argv.watch,
      minify: argv.minify,
      inlined: argv.inlined,
      linked: argv.linked
    });

  return h(compiled.build)
    .map(reporter.logAction(argv.reporter, 'fonts'))
    .toArray((results) => {
      const compiledFiles = _.map(_.filter(results, (result) => result.type === 'success'), (result) => result.message),
        t2 = Date.now();

      reporter.logSummary(argv.reporter, 'fonts', (successes) => {
        let message = `Compiled ${pluralize('font', successes, true)} in ${time(t2, t1)}`;

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
  command: 'fonts',
  describe: 'Compile fonts',
  aliases: ['f'],
  builder,
  handler
};

'use strict';

const { build, watch } = require('../lib/cmd/vite');
const log = require('./log').setup({ file: __filename });

function builder(yargs) {
  return yargs
    .usage('Usage: $0 [options]')
    .option('watch', {
      alias: 'w',
      type: 'boolean',
      description: 'Watch for file changes and rebuild automatically',
      default: false,
    })
    .option('minify', {
      alias: 'm',
      type: 'boolean',
      description: 'Minify output (also enabled by CLAYCLI_COMPILE_MINIFIED env var)',
      default: !!process.env.CLAYCLI_COMPILE_MINIFIED,
    })
    .option('entry', {
      alias: 'e',
      type: 'array',
      description: 'Additional entry-point file paths (supplements the default component globs)',
      default: [],
    })
    .example('$0', 'Build all component scripts with Rollup')
    .example('$0 --watch', 'Rebuild on every file change')
    .example('$0 --minify', 'Build and minify for production');
}

async function handler(argv) {
  const options = {
    minify: argv.minify,
    extraEntries: argv.entry || [],
  };

  if (argv.watch) {
    try {
      const ctx = await watch({
        ...options,
        onRebuild(errors) {
          if (errors.length > 0) {
            errors.forEach(e => log('error', e.message || String(e)));
          } else {
            log('info', '[js] Rebuilt successfully');
          }
        },
      });

      log('info', 'Watching for changes — press Ctrl+C to stop');

      process.on('SIGINT', () => {
        ctx.dispose().then(() => process.exit(0));
      });

      process.on('SIGTERM', () => {
        ctx.dispose().then(() => process.exit(0));
      });
    } catch (error) {
      log('error', 'Watch setup failed', { error: error.message });
      process.exit(1);
    }
  } else {
    try {
      await build(options);
    } catch (error) {
      log('error', 'Build failed', { error: error.message });
      process.exit(1);
    }
  }
}

exports.aliases = [];
exports.builder = builder;
exports.command = 'vite';
exports.describe = 'Compile component scripts and assets with Rollup';
exports.handler = handler;

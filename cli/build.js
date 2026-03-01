'use strict';

const { build, watch } = require('../lib/cmd/build');
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
    .example('$0', 'Build all component scripts with esbuild')
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
          // In watch mode only surface errors — esbuild reports warnings for
          // every file it touches on each incremental rebuild, not just the
          // changed file, which floods the terminal with irrelevant noise.
          // Warnings are still visible in full during `make compile`.
          if (errors.length > 0) {
            errors.forEach(e => log('error', e.text, { location: e.location }));
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
      const result = await build(options);

      if (result.errors.length > 0) {
        result.errors.forEach(e => log('error', e.text, { location: e.location }));
        process.exit(1);
      }

      // esbuild warnings are pre-existing code issues (duplicate object keys,
      // typeof-null, etc.) that are not actionable build failures. Log a count
      // so they are visible without flooding the terminal with full locations.
      if (result.warnings.length > 0) {
        log('warn', `${result.warnings.length} esbuild warning(s) — run with --log-level=verbose to see details`);
      }
    } catch (error) {
      log('error', 'Build failed', { error: error.message });
      process.exit(1);
    }
  }
}

exports.aliases = ['pack-next', 'pn']; // pack-next kept for backward compat with existing Makefiles
exports.builder = builder;
exports.command = 'build';
exports.describe = 'Compile component scripts and assets with esbuild';
exports.handler = handler;

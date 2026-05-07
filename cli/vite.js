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
    .option('only', {
      type: 'array',
      description: 'Build only selected steps: js, styles, fonts, templates, vendor, media',
      default: [],
      coerce: values => {
        const list = Array.isArray(values) ? values : [values];

        return list
          .flatMap(v => String(v).split(','))
          .map(v => v.trim())
          .filter(Boolean);
      },
    })
    .example('$0', 'Build all component scripts and assets with Vite')
    .example('$0 --watch', 'Rebuild on every file change')
    .example('$0 --minify', 'Build and minify for production')
    .example('$0 --only styles,templates', 'Build only selected asset pipelines');
}

async function handler(argv) {
  const validOnly = new Set(['all', 'js', 'styles', 'fonts', 'templates', 'vendor', 'media']);
  const only = (argv.only || []).filter(Boolean);
  const invalid = only.filter(item => !validOnly.has(item));

  if (invalid.length) {
    log('error', `Invalid --only value(s): ${invalid.join(', ')}`);
    process.exit(1);
  }

  const options = {
    minify:       argv.minify,
    extraEntries: argv.entry || [],
    only,
  };

  if (argv.watch) {
    try {
      const ctx = await watch({
        ...options,
        // Called once after the first successful build — correct place for the
        // "ready" message because watch() resolves before BUNDLE_END fires.
        onReady() {
          log('info', 'Watching for changes — press Ctrl+C to stop');
        },
        // Only report errors here; successful rebuilds are already logged by
        // scripts.js with the module-count suffix to avoid duplicate output.
        onRebuild(errors) {
          errors.forEach(e => log('error', e.message || String(e)));
        },
      });

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

exports.aliases  = [];
exports.builder  = builder;
exports.command  = 'vite';
exports.describe = 'Compile component scripts and assets with Vite (Rollup production, HMR watch)';
exports.handler  = handler;

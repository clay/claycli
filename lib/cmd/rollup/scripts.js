'use strict';

const rollup = require('rollup');
const nodeResolve = require('@rollup/plugin-node-resolve').default;
const commonjs = require('@rollup/plugin-commonjs');
const json = require('@rollup/plugin-json');
const fs = require('fs-extra');
const { globSync } = require('glob');
const path = require('path');

const { getConfigValue } = require('../../config-file-helpers');
const browserCompatPlugin = require('./plugins/browser-compat');
const serviceRewritePlugin = require('./plugins/service-rewrite');
const vue2Plugin = require('./plugins/vue2');
const manualChunksPlugin = require('./plugins/manual-chunks');
const esbuildTransformPlugin = require('./plugins/esbuild-transform');
const { writeManifest } = require('./manifest');
const { buildStyles, SRC_GLOBS: STYLE_GLOBS } = require('../build/styles');
const { buildFonts, FONTS_SRC_GLOB } = require('../build/fonts');
const { buildTemplates, TEMPLATE_GLOB_PATTERN } = require('../build/templates');
const { copyVendor } = require('../build/vendor');
const { copyMedia } = require('../build/media');
const {
  generateKilnEditEntry,
  generateGlobalsInitEntry,
  generateClientEnv,
} = require('../build/scripts');
const {
  generateRollupBootstrap,
  ROLLUP_BOOTSTRAP_FILE,
  ROLLUP_BOOTSTRAP_KEY,
} = require('./generate-bootstrap');

const CWD = process.cwd();

const DEST = path.join(CWD, 'public', 'js');

// Pre-initialise window.kiln.* namespaces before any module evaluates.
// Used as output.banner for both the one-shot kiln build (buildJS) and the
// initial kiln build in watch mode — kept here as a single source of truth.
const KILN_BANNER = [
  '(function(){',
  '  var k = window.kiln = window.kiln || {};',
  '  k.config  = k.config  || {};',
  '  k.config.pyxis = k.config.pyxis || {};',
  '  k.utils   = k.utils   || {};',
  '  k.utils.components = k.utils.components || {};',
  '  k.utils.references = k.utils.references || {};',
  '  k.utils.componentElements = k.utils.componentElements || {};',
  '  k.utils.logger = k.utils.logger || function(){ return { log:function(){}, error:function(){} }; };',
  '  k.inputs  = k.inputs  || {};',
  '  k.modals  = k.modals  || {};',
  '  k.plugins = k.plugins || {};',
  '  k.toolbarButtons = k.toolbarButtons || {};',
  '  k.navButtons = k.navButtons || {};',
  '  k.navContent = k.navContent || {};',
  '  k.validators = k.validators || {};',
  '  k.transformers = k.transformers || {};',
  '  k.kilnInput = k.kilnInput || function(){};',
  '})();',
].join('\n');
const CLAY_DIR = path.join(CWD, '.clay');

const KILN_EDIT_ENTRY_FILE = path.join(CLAY_DIR, '_kiln-edit-init.js');
const GLOBALS_INIT_ENTRY_FILE = path.join(CLAY_DIR, '_globals-init.js');

exports.ROLLUP_BOOTSTRAP_KEY = ROLLUP_BOOTSTRAP_KEY;

const KILN_EDIT_ENTRY_KEY = path.relative(CWD, KILN_EDIT_ENTRY_FILE)
  .replace(/\\/g, '/')
  .replace(/\.js$/, '');

exports.KILN_EDIT_ENTRY_KEY = KILN_EDIT_ENTRY_KEY;

async function prepareRollupEntries() {
  await generateGlobalsInitEntry();
  await generateRollupBootstrap();
}

/**
 * Build the shared Rollup input plugins array.
 *
 * Plugin order:
 *   1. missing-module    — stubs missing project files to prevent hard errors
 *   2. browser-compat    — intercepts Node built-ins before the resolver
 *   3. service-rewrite   — redirects services/server → client before resolution
 *   4. vue2              — compiles .vue SFCs before commonjs sees them
 *   5. json              — handles .json imports
 *   6. esbuild-transform — define substitutions + optional minification
 *   7. node-resolve      — resolves node_modules using browser fields
 *   8. commonjs          — converts require() to ESM imports
 *   9. user plugins      — appended from rollupConfig.plugins
 *
 * @param {object} [options]
 * @param {object} [overrides] - Optional extra config from rollupConfig hook
 * @returns {Array}
 */
function buildPlugins(options, overrides) {
  // User-defined defines (e.g. DS → window.DS) are merged into the esbuild
  // define map alongside builtins.
  const userDefineMap = (overrides && overrides.define) || {};

  // Sites can supply additional CJS excludes via commonjsExclude in rollupConfig().
  // Useful for pre-bundled webpack packages (eval()-based internal modules) that
  // break when @rollup/plugin-commonjs wraps them (e.g. eval() scope issues).
  const cjsExclude = (overrides && overrides.commonjsExclude) || [];

  // Module alias map from rollupConfig().alias — redirects bare specifiers before
  // any other plugin sees them (same role as esbuildConfig.alias in the build pipeline).
  const aliasMap = (overrides && overrides.alias) || {};
  const aliasEntries = Object.keys(aliasMap);

  const plugins = [
    // Alias redirects must be first so they win over every other resolver.
    ...(aliasEntries.length > 0 ? [{
      name: 'clay-alias',
      resolveId(id) {
        if (id in aliasMap) return { id: aliasMap[id], external: false };
        return null;
      },
    }] : []),
    missingModulePlugin(),
    browserCompatPlugin(),
    serviceRewritePlugin(),
    vue2Plugin(),
    json(),
    esbuildTransformPlugin({ minify: options && options.minify, define: userDefineMap }),
    nodeResolve({
      browser: true,
      preferBuiltins: false,
      mainFields: ['browser', 'main', 'module'],
    }),
    // `include` must cover .vue so @rollup/plugin-commonjs participates in
    // building the module graph for .vue files.  Even though vue2Plugin outputs
    // pure ESM (all require() calls hoisted to import declarations), excluding
    // .vue IDs from commonjs changes the topological sort of the module graph.
    // With circular CJS dependencies (e.g. auth.js ↔ gtm.js), that sort change
    // shifts WHICH module receives the partial-initialization object, causing
    // "X is not a function" runtime errors.  Keeping .vue in include preserves
    // the expected graph ordering: commonjs detects .vue output as ESM and skips
    // actual transformation, but its analysis pass still anchors the sort correctly.
    //
    // `strictRequires: 'auto'` handles circular CJS dependencies correctly.
    // When the plugin detects a require() call that participates in a cycle it
    // wraps only that require in a lazy getter so exports are not read until both
    // factories have finished running.  Non-circular requires stay eager (no
    // overhead).  Without this, the evaluation ORDER of __commonJS() factories in
    // the output chunk determines which module gets the partial ({}) init object —
    // a fragile topological-sort dependency that breaks whenever anything alters the
    // chunk graph (e.g. adding define-substitution to .vue files).
    //
    // `extensions` is intentionally left at its default (['.js']).  Adding '.cjs'
    // changes how require() calls are RESOLVED (the plugin tries those extensions
    // when looking up required files).  Some node_modules .cjs files export via
    // Object.create(null) (null-prototype objects); when the CJS plugin wraps them
    // it exposes that null-prototype, which breaks callsites that call
    // .hasOwnProperty() on the returned value.
    commonjs({
      include:                 /\.(js|cjs|vue)$/,
      transformMixedEsModules: true,
      requireReturnsDefault:   'preferred',
      strictRequires:          'auto',
      exclude:                 cjsExclude,
    }),
  ];

  // Allow consuming repos to append extra plugins via rollupConfig hook
  const extraPlugins = (overrides && overrides.plugins) || [];

  plugins.push(...extraPlugins);

  return plugins;
}

/**
 * Build the Rollup config object and apply the rollupConfig customizer from
 * claycli.config.js (parallel to esbuildConfig).
 *
 * Config shape:
 *   {
 *     minify:              false,
 *     extraEntries:        [],
 *     manualChunksMinSize: 4096,  // bytes — private deps below this are inlined; set 0 to disable
 *     define:              {},    // merged on top of built-in esbuild defines
 *     plugins:             [],    // extra Rollup plugins (appended after built-ins)
 *     alias:               {},    // module alias map { 'specifier': 'replacement' }
 *     commonjsExclude:     [],    // extra patterns passed to @rollup/plugin-commonjs `exclude`.
 *                                 // Use this to exempt pre-bundled webpack packages (e.g.
 *                                 // those using eval()-based internal module systems) from
 *                                 // CJS transformation, since wrapping them breaks their
 *                                 // internal eval() scope.
 *                                 // Example: [/node_modules\/pyxis-frontend\//]
 *   }
 *
 * @param {object} [options]
 * @returns {object}
 */
function getRollupConfig(options = {}) {
  const config = {
    minify:              options.minify || false,
    extraEntries:        options.extraEntries || [],
    manualChunksMinSize: 4096,
    define:              {},
    plugins:             [],
    alias:               {},
    commonjsExclude:     [],
  };

  const customizer = getConfigValue('rollupConfig');

  if (typeof customizer === 'function') {
    const customized = customizer(config);

    if (customized && typeof customized === 'object') {
      return customized;
    }
  }

  return config;
}

exports.getRollupConfig = getRollupConfig;

/**
 * Collect all default entry points for the splitting bundle (Pass 1).
 *
 * @param {string[]} [extraEntries]
 * @returns {string[]}
 */
function getDefaultEntryPoints(extraEntries = []) {
  const existingExtras = extraEntries.filter(f => fs.existsSync(f));

  return [ROLLUP_BOOTSTRAP_FILE, ...existingExtras];
}

/**
 * Convert an array of absolute entry paths into the Rollup input object.
 * Keys use path-relative-to-CWD without extension to match the esbuild
 * entryNames: '[dir]/[name]-[hash]' behaviour.
 *
 * @param {string[]} entries
 * @returns {object}
 */
function entriesToInputMap(entries) {
  const map = {};

  for (const absPath of entries) {
    const rel = path.relative(CWD, absPath).replace(/\\/g, '/').replace(/\.js$/, '');

    map[rel] = absPath;
  }

  return map;
}

/**
 * Run all three Rollup build passes and write _manifest.json.
 *
 * Pass 1 — rollup-bootstrap only: sync-imports globals, then code-splits components
 * Pass 2 — kiln no-split bundle (_kiln-edit-init) for edit mode
 *
 * Minification (when options.minify is true) is handled in-memory by the
 * esbuildTransformPlugin's renderChunk hook — no post-build disk I/O needed.
 *
 * @param {object} [options]
 * @returns {Promise<void>}
 */
async function buildJS(options = {}) {
  await generateKilnEditEntry();
  await prepareRollupEntries();

  const rollupConfig = getRollupConfig(options);
  const minChunkSize = rollupConfig.manualChunksMinSize ?? 4096;

  const entryPoints = getDefaultEntryPoints(rollupConfig.extraEntries);

  if (!fs.existsSync(ROLLUP_BOOTSTRAP_FILE)) {
    throw new Error('clay rollup: missing .clay/rollup-bootstrap.js after prepare.');
  }

  await fs.ensureDir(DEST);
  await fs.ensureDir(path.join(DEST, '.clay'));

  // ── Passes 1 & 2 run in parallel ─────────────────────────────────────────
  // Pass 1 writes to DEST (public/js/), Pass 2 writes to DEST/.clay/ —
  // different output directories with no shared state, so they run concurrently.
  async function runPass1() {
    const bundle = await rollup.rollup({
      input:   entriesToInputMap(entryPoints),
      plugins: buildPlugins(options, rollupConfig),
      onwarn:  suppressWarning,
    });

    const output = await bundle.write({
      format:         'esm',
      dir:            DEST,
      entryFileNames: '[name]-[hash].js',
      chunkFileNames: 'chunks/[name]-[hash].js',
      manualChunks:   manualChunksPlugin(minChunkSize, CWD),
      sourcemap:      true,
    });

    await bundle.close();
    return output;
  }

  async function runPass2() {
    const bundle = await rollup.rollup({
      input:   KILN_EDIT_ENTRY_FILE,
      plugins: buildPlugins(options, rollupConfig),
      onwarn:  suppressWarning,
    });

    const output = await bundle.write({
      format:               'esm',
      dir:                  path.join(DEST, '.clay'),
      entryFileNames:       '[name]-[hash].js',
      inlineDynamicImports: true,
      sourcemap:            true,
      // Pre-initialise window.kiln.* namespaces before any module evaluates.
      // With inlineDynamicImports:true Rollup inlines ALL module code in dependency
      // order. Kiln plugin .vue files access window.kiln.config.pyxis and other
      // window.kiln.* properties at MODULE-EVALUATION time (top-level code), before
      // _initKilnPlugins() sets them at the end of the bundle. The banner ensures
      // those globals are at least empty objects so destructuring never throws.
      banner: KILN_BANNER,
    });

    await bundle.close();
    return output;
  }

  const [pass1Output, pass2Output] = await Promise.all([runPass1(), runPass2()]);

  const mergedBundle = mergeBundles(pass1Output, pass2Output, null);

  await writeManifest(mergedBundle, DEST);
}

exports.buildJS = buildJS;

/**
 * Merge multiple Rollup output objects into a single bundle map for manifest writing.
 *
 * Pass 2 (kiln) and Pass 3 (globals) write to DEST/.clay/ so their chunk
 * fileNames are relative to that subdirectory.  Prefix them with ".clay/" so
 * the manifest URLs match esbuild's outbase: CWD layout
 * (e.g. /js/.clay/_kiln-edit-init-HASH.js).
 *
 * @param {object|null} pass1Output  - Splitting bundle (written to DEST)
 * @param {object|null} pass2Output  - Kiln no-split bundle (written to DEST/.clay)
 * @param {object|null} pass3Output  - unused (globals live in pass 1 graph)
 * @returns {object}
 */
function mergeBundles(pass1Output, pass2Output, pass3Output) {
  const merged = {};

  if (pass1Output) {
    for (const chunk of (pass1Output.output || [])) {
      merged[chunk.fileName] = chunk;
    }
  }

  for (const subOutput of [pass2Output, pass3Output]) {
    if (!subOutput) continue;

    for (const chunk of (subOutput.output || [])) {
      merged[`.clay/${chunk.fileName}`] = { ...chunk, fileName: `.clay/${chunk.fileName}` };
    }
  }

  return merged;
}

/**
 * Run all build steps in parallel (JS + assets).
 *
 * @param {object} [options]
 * @returns {Promise<void>}
 */
async function buildAll(options = {}) {
  const isTTY = process.stdout.isTTY;

  const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

  const clr = {
    label:   s => `\x1b[36m${s}\x1b[0m`,
    done:    s => `\x1b[32m${s}\x1b[0m`,
    fail:    s => `\x1b[31m${s}\x1b[0m`,
    time:    s => `\x1b[90m${s}\x1b[0m`,
    spin:    s => `\x1b[33m${s}\x1b[0m`,
    pct:     s => `\x1b[97m${s}\x1b[0m`,
    barFill: s => `\x1b[32m${s}\x1b[0m`,
    barBg:   s => `\x1b[90m${s}\x1b[0m`,
  };

  const MAX_LBL = 'client-env'.length;

  function fmtLabel(l) {
    return clr.label(`[${l.padEnd(MAX_LBL)}]`);
  }

  const states    = new Map();
  const totalStart = Date.now();

  let spinFrame   = 0;
  let timer       = null;
  let progressUp  = false;

  const BAR_W = 16;

  function progressBar(done, total) {
    const ratio  = total > 0 ? Math.min(1, done / total) : 0;
    const filled = Math.round(ratio * BAR_W);
    const pct    = `${Math.floor(ratio * 100)}%`.padStart(4);

    return (
      clr.barFill('█'.repeat(filled)) +
      clr.barBg('░'.repeat(BAR_W - filled)) +
      ' ' + clr.pct(pct) +
      ' ' + clr.time(`${done}/${total}`)
    );
  }

  function doneLine(label) {
    const s    = states.get(label);
    const icon = s.error ? clr.fail('✗') : clr.done('✓');
    const word = s.error ? 'failed' : 'done  ';
    const prog = s.total > 0 ? ` ${progressBar(s.total, s.total)}` : '';

    return `${icon} ${fmtLabel(label)} ${word}${prog} ${clr.time(`(${s.elapsed}s)`)}`;
  }

  function buildSummaryLine() {
    const running = [...states.entries()].filter(([, s]) => !s.done);

    if (running.length === 0) return null;

    const spin  = clr.spin(SPINNER[spinFrame % SPINNER.length]);
    const total = ((Date.now() - totalStart) / 1000).toFixed(1);

    const parts = running.map(([label, s]) => {
      if (s.total > 0) {
        const pct = Math.floor(s.progress / s.total * 100);

        return `${clr.label(`[${label}`)} ${clr.pct(pct + '%')}${clr.label(']')}`;
      }

      return clr.label(`[${label}]`);
    });

    return `${spin} ${parts.join(' ')} ${clr.time(`(${total}s)`)}`;
  }

  function clearSummary() {
    if (isTTY && progressUp) {
      process.stdout.write('\r\x1b[2K');
      progressUp = false;
    }
  }

  function writeSummary() {
    if (!isTTY) return;
    const line = buildSummaryLine();

    if (line) {
      process.stdout.write(line);
      progressUp = true;
    }
  }

  function printError(msg) {
    clearSummary();
    process.stderr.write(`${msg}\n`);
    writeSummary();
  }

  function startStep(label) {
    states.set(label, { start: Date.now(), done: false, error: false, total: 0, progress: 0 });
    if (!isTTY) {
      process.stdout.write(`  ${fmtLabel(label)} starting...\n`);
    }
  }

  function onProgressFor(label) {
    return (done, total) => {
      const s = states.get(label);

      if (s) { s.progress = done; s.total = total; }
    };
  }

  function finishStep(label, error = false) {
    const s = states.get(label);

    if (s) {
      s.done    = true;
      s.error   = error;
      s.elapsed = ((Date.now() - s.start) / 1000).toFixed(1);
    }

    if (isTTY) {
      clearSummary();
      process.stdout.write(`${doneLine(label)}\n`);

      if ([...states.values()].every(v => v.done)) {
        clearInterval(timer);
        timer = null;
      } else {
        writeSummary();
      }
    } else {
      process.stdout.write(`${doneLine(label)}\n`);
    }
  }

  function step(label, fn) {
    startStep(label);
    return fn(onProgressFor(label))
      .then(result  => { finishStep(label);        return result; })
      .catch(e      => {
        process.stderr.write(`\n${clr.fail('[error]')} ${clr.label(label)}: ${e.message}\n`);
        finishStep(label, true);
      });
  }

  process.stdout.write('\nBuilding assets...\n');

  if (isTTY) {
    timer = setInterval(() => {
      spinFrame++;
      clearSummary();
      writeSummary();
    }, 80);
  }

  // media must complete first — templates inlines SVG files from public/media/
  // at build time via {{{ read 'public/media/...' }}} helpers, so the files
  // must exist on disk before the templates step starts.
  await step('media', () => copyMedia());

  await Promise.all([
    step('js',         ()     => buildJS(options)),
    step('styles',     onProg => buildStyles({ ...options, onProgress: onProg, onError: printError })),
    step('fonts',      ()     => buildFonts()),
    step('templates',  onProg => buildTemplates({ ...options, onProgress: onProg })),
    step('vendor',     ()     => copyVendor()),
    step('client-env', ()     => generateClientEnv()),
  ]);

  if (timer) { clearInterval(timer); timer = null; }
  clearSummary();

  const totalSecs = ((Date.now() - totalStart) / 1000).toFixed(1);

  process.stdout.write(`\n${clr.done('Build complete')} ${clr.time(`(${totalSecs}s total)`)}\n\n`);
}

/**
 * One-shot full build.
 *
 * @param {object} [options]
 * @returns {Promise<void>}
 */
async function build(options = {}) {
  return buildAll(options);
}

exports.build = build;
exports.buildAll = buildAll;

/**
 * Start file watchers that rebuild only what changes.
 *
 * Uses rollup.watch() for JS (incremental rebuilds) and the same chokidar
 * watchers as the esbuild pipeline for CSS, fonts, and templates.
 *
 * @param {object}   [options]
 * @param {boolean}  [options.minify=false]
 * @param {string[]} [options.extraEntries=[]]
 * @param {function} [options.onRebuild] - Called after each JS rebuild with (errors).
 * @returns {Promise<object>} context with a dispose() method
 */
async function watch(options = {}) {
  const { onRebuild } = options;
  const chokidar = require('chokidar');

  const chokidarOpts = {
    ignoreInitial: true,
    usePolling: true,
    interval: 100,
    awaitWriteFinish: { stabilityThreshold: 50, pollInterval: 50 },
  };

  function debounce(fn, ms) {
    let timer;

    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), ms);
    };
  }

  function rel(absPath) {
    return path.relative(CWD, absPath);
  }

  const clr = {
    changed: s => `\x1b[33m${s}\x1b[0m`,
    rebuilt: s => `\x1b[32m${s}\x1b[0m`,
    file:    s => `\x1b[36m${s}\x1b[0m`,
    error:   s => `\x1b[31m${s}\x1b[0m`,
  };

  // --- Lazy Rollup watch setup ---------------------------------------------

  const rollupReady = (async () => {
    if (!fs.existsSync(KILN_EDIT_ENTRY_FILE)) {
      await generateKilnEditEntry();
    }

    await prepareRollupEntries();

    const rollupConfig = getRollupConfig(options);
    const plugins = buildPlugins(options, rollupConfig);
    const minChunkSize = rollupConfig.manualChunksMinSize ?? 4096;
    const entryPoints = getDefaultEntryPoints(rollupConfig.extraEntries);

    await fs.ensureDir(DEST);
    await fs.ensureDir(path.join(DEST, '.clay'));

    // Both passes run as rollup.watch() instances so they each rebuild
    // automatically when their source files change.  The manifest is written
    // only once BOTH have produced at least one output (mergeAndWriteManifest
    // is a no-op until both latestKilnOutput and currentPass1Bundle are set).
    let latestKilnOutput  = null;
    let currentPass1Bundle = null;

    async function mergeAndWriteManifest() {
      if (!latestKilnOutput || !currentPass1Bundle) return;

      const merged = mergeBundles(
        { output: Object.values(currentPass1Bundle) },
        latestKilnOutput,
        null
      );

      await writeManifest(merged, DEST);
      if (onRebuild) onRebuild([]);
      console.log(clr.rebuilt('[js] Rebuilt successfully'));
    }

    // Pass 2 watcher — kiln no-split bundle.  Rebuilds whenever a kiln plugin
    // .vue file or its dependencies change.
    const kilnWatcher = rollup.watch({
      input:   KILN_EDIT_ENTRY_FILE,
      plugins,
      onwarn:  suppressWarning,
      output: {
        format:               'esm',
        dir:                  path.join(DEST, '.clay'),
        entryFileNames:       '[name]-[hash].js',
        inlineDynamicImports: true,
        sourcemap:            true,
        banner:               KILN_BANNER,
      },
      watch: {
        exclude: [
          path.join(CWD, 'public', '**'),
          path.join(CWD, 'node_modules', '**'),
        ],
      },
    });

    kilnWatcher.on('event', async (event) => {
      if (event.code === 'BUNDLE_END') {
        if (event.result && event.result.output) {
          latestKilnOutput = { output: event.result.output };
          await mergeAndWriteManifest();
        }

        event.result && event.result.close && event.result.close();
      } else if (event.code === 'ERROR') {
        console.error(clr.error(`[js/kiln] Build error: ${event.error.message}`));
      }
    });

    // Pass 1 watcher — splitting bundle (components + shared chunks).
    const watcher = rollup.watch({
      input:  entriesToInputMap(entryPoints),
      plugins,
      onwarn: suppressWarning,
      output: {
        format:         'esm',
        dir:            DEST,
        entryFileNames: '[name]-[hash].js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        manualChunks:   manualChunksPlugin(minChunkSize, CWD),
        sourcemap:      true,
      },
      watch: {
        skipWrite: false,
        exclude: [
          path.join(CWD, 'public', '**'),
          path.join(CWD, 'node_modules', '**'),
        ],
      },
    });

    watcher.on('event', async (event) => {
      if (event.code === 'BUNDLE_START') {
        console.log(clr.changed('[js] Rebuilding...'));
      } else if (event.code === 'BUNDLE_END') {
        if (event.result) {
          currentPass1Bundle = event.result.output
            ? event.result.output.reduce((acc, chunk) => { acc[chunk.fileName] = chunk; return acc; }, {})
            : null;

          await mergeAndWriteManifest();
        }

        event.result && event.result.close && event.result.close();
      } else if (event.code === 'ERROR') {
        console.error(clr.error(`[js] Build error: ${event.error.message}`));
        if (onRebuild) onRebuild([event.error]);
      }
    });

    return {
      watcher,
      kilnWatcher,
      dispose: async () => {
        watcher.close();
        kilnWatcher.close();
      },
    };
  })().catch(e => {
    console.error('[js] Watch setup failed:', e.message);
  });

  // --- JS watcher (for model/kiln/global changes that need full rebuild) ----

  const JS_GLOBS = [
    path.join(CWD, 'components', '**', '*.js'),
    path.join(CWD, 'components', '**', '*.vue'),
    path.join(CWD, 'layouts', '**', '*.js'),
    path.join(CWD, 'global', '**', '*.js'),
    path.join(CWD, 'services', '**', '*.js'),
    KILN_EDIT_ENTRY_FILE,
    ROLLUP_BOOTSTRAP_FILE,
    GLOBALS_INIT_ENTRY_FILE,
  ];

  const rebuildJs = debounce(async (changedFile, eventType) => {
    if (changedFile) console.log(clr.changed('[js] Changed: ') + clr.file(rel(changedFile)));

    if (
      (eventType !== 'change' && changedFile && changedFile.endsWith('client.js')) ||
      (changedFile && changedFile.includes(`${path.sep}global${path.sep}`))
    ) {
      await prepareRollupEntries();
    }
  }, 200);

  const jsWatcher = chokidar.watch(JS_GLOBS, {
    ...chokidarOpts,
    ignored: [
      path.join(CWD, 'public', '**'),
      path.join(CWD, 'node_modules', '**'),
    ],
  });

  jsWatcher
    .on('change', f => rebuildJs(f, 'change'))
    .on('add',    f => rebuildJs(f, 'add'))
    .on('unlink', f => rebuildJs(f, 'unlink'));

  // --- CSS watcher ----------------------------------------------------------

  const rebuildStyles = debounce((changedFile) => {
    const componentPrefix = changedFile
      ? path.basename(changedFile, '.css').split('_')[0]
      : null;
    const changedFiles = componentPrefix
      ? STYLE_GLOBS.flatMap(g => globSync(g)).filter(f => {
        const stem = path.basename(f, '.css');

        return stem === componentPrefix || stem.startsWith(`${componentPrefix}_`);
      })
      : null;

    if (changedFile) {
      console.log(clr.changed('[styles] Changed: ') + clr.file(rel(changedFile)));
    }

    return buildStyles({ ...options, changedFiles })
      .then(paths => {
        if (paths.length > 0) {
          console.log(clr.rebuilt('[styles] Rebuilt: ') + clr.file(paths.map(p => rel(p)).join(', ')));
        }
      })
      .catch(e => console.error(clr.error(`[styles] rebuild failed: ${e.message}`)));
  }, 200);

  const cssWatcher = chokidar.watch(STYLE_GLOBS, chokidarOpts);

  cssWatcher.on('change', rebuildStyles).on('add', rebuildStyles).on('unlink', rebuildStyles);

  // --- Font watcher ---------------------------------------------------------

  const rebuildFonts = debounce((changedFile) => {
    if (changedFile) console.log(clr.changed('[fonts] Changed: ') + clr.file(rel(changedFile)));

    return buildFonts()
      .then(() => console.log(clr.rebuilt('[fonts] Rebuilt')))
      .catch(e => console.error(clr.error(`[fonts] rebuild failed: ${e.message}`)));
  }, 200);

  const fontWatcher = chokidar.watch(FONTS_SRC_GLOB, chokidarOpts);

  fontWatcher.on('change', rebuildFonts).on('add', rebuildFonts).on('unlink', rebuildFonts);

  // --- Template watcher -----------------------------------------------------

  const rebuildTemplates = debounce((changedFile) => {
    if (changedFile) console.log(clr.changed('[templates] Changed: ') + clr.file(rel(changedFile)));

    return buildTemplates({ ...options, watch: true })
      .then(() => console.log(clr.rebuilt('[templates] Rebuilt')))
      .catch(e => console.error(clr.error(`[templates] rebuild failed: ${e.message}`)));
  }, 200);

  const templateGlobs = [
    path.join(CWD, 'components', '**', TEMPLATE_GLOB_PATTERN),
    path.join(CWD, 'layouts', '**', TEMPLATE_GLOB_PATTERN),
  ];

  const templateWatcher = chokidar.watch(templateGlobs, chokidarOpts);

  templateWatcher.on('change', rebuildTemplates).on('add', rebuildTemplates).on('unlink', rebuildTemplates);

  // --- Wait until every chokidar watcher has finished its initial scan ------

  const allWatchers = [jsWatcher, cssWatcher, fontWatcher, templateWatcher];

  await Promise.all(allWatchers.map(w => new Promise(resolve => w.once('ready', resolve))));

  return {
    dispose: async () => {
      await Promise.all(allWatchers.map(w => w.close()));

      const ctx = await rollupReady.catch(() => null);

      if (ctx) await ctx.dispose();
    },
  };
}

exports.watch = watch;

/**
 * Suppress noisy Rollup warnings that are expected for CJS-heavy codebases.
 *
 * @param {object} warning
 * @param {function} warn - default warn handler
 */
function suppressWarning(warning, warn) {
  // Circular dependencies are common in Node/CJS packages — not an error
  if (warning.code === 'CIRCULAR_DEPENDENCY') return;
  // THIS_IS_UNDEFINED warnings are expected when converting CJS to ESM
  if (warning.code === 'THIS_IS_UNDEFINED') return;
  // Missing named exports from CJS modules are expected
  if (warning.code === 'MISSING_GLOBAL_NAME') return;
  // Unresolved imports that were already handled by missingModulePlugin
  if (warning.code === 'UNRESOLVED_IMPORT') return;
  // Missing default exports from CJS modules
  if (warning.code === 'MISSING_EXPORT') return;
  // eval() usage warnings from node_modules (e.g. pyxis-frontend) — esbuild
  // suppresses these entirely via logLevel: 'silent'; match that behaviour here.
  if (warning.code === 'EVAL' && warning.id && warning.id.includes('/node_modules/')) return;

  warn(warning);
}

/**
 * Rollup plugin that silently marks any import whose resolved file does not
 * exist on disk as external rather than hard-erroring.
 *
 * esbuild silently skips unresolvable paths (e.g. components deleted after
 * _view-init.js was generated). Rollup errors hard on them. This plugin
 * restores the same lenient behaviour: missing files are treated as external
 * (they produce no output and no browser request) and a warning is printed
 * so the developer knows something is stale.
 */
function missingModulePlugin() {
  // Per-build caches for synchronous file-system calls made inside resolveId.
  //
  // The same shared utility (e.g. services/universal/utils.js) can be imported
  // by hundreds of components.  Without caching, each import triggers up to
  // 3× fs.statSync calls (the three candidate extensions) plus an fs.readFileSync
  // to check for empty files.  A Map keyed by absolute candidate path eliminates
  // repeat disk reads for the duration of the build.
  const statCache  = new Map(); // candidate path → boolean (file exists)
  const emptyCache = new Map(); // existing file path → boolean (file is empty)

  function fileExists(p) {
    if (statCache.has(p)) return statCache.get(p);
    let result;

    try { result = fs.statSync(p).isFile(); } catch (_) { result = false; }
    statCache.set(p, result);
    return result;
  }

  function fileIsEmpty(p) {
    if (emptyCache.has(p)) return emptyCache.get(p);
    let result;

    try { result = fs.readFileSync(p, 'utf8').trim() === ''; } catch (_) { result = false; }
    emptyCache.set(p, result);
    return result;
  }

  return {
    name: 'clay-missing-module',
    resolveId(id, importer) {
      // Only intercept relative imports
      if (!importer) return null;
      if (!id.startsWith('.')) return null;

      // Strip virtual module suffixes (e.g. "\0" prefixes, "?commonjs-entry" from
      // @rollup/plugin-commonjs) to get a real path we can stat on disk.
      const realImporter = importer.replace(/\?commonjs-\w+$/, '').replace(/\0/g, '');

      // Skip virtual modules that have no real path on disk
      if (!realImporter || !path.isAbsolute(realImporter)) return null;

      // Only stub missing paths for project source (e.g. stale _view-init → deleted
      // client.js). Never touch node_modules: cheerio uses require('./package')
      // (package.json), htmlparser2 uses require('../') to the package main — our
      // naive file stat would wrongly stub those and break the whole client bundle.
      if (realImporter.includes(`${path.sep}node_modules${path.sep}`)) {
        return null;
      }

      const resolved = path.resolve(path.dirname(realImporter), id);
      const candidates = [resolved, resolved + '.js', path.join(resolved, 'index.js')];
      const existingFile = candidates.find(fileExists);

      if (!existingFile) {
        console.warn(`[rollup] skipping missing module: ${id} (imported from ${path.relative(CWD, realImporter)})`);
        return { id: `\0missing:${id}`, external: false };
      }

      // If the file exists but is empty, redirect to our stub virtual module
      // so `import foo from './empty.js'` doesn't fail with MISSING_EXPORT.
      if (fileIsEmpty(existingFile)) {
        return { id: `\0missing:${id}`, external: false };
      }

      return null;
    },

    load(id) {
      if (id.startsWith('\0missing:')) {
        // Return a minimal ESM stub so nothing crashes at runtime.
        // module.exports = {} must NOT appear here — it is not valid in an
        // ESM file and would throw ReferenceError: module is not defined.
        return 'export default undefined;';
      }
      return null;
    },
  };
}

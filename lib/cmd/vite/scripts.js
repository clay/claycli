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
  generateViewInitEntry,
  generateGlobalsInitEntry,
  generateClientEnv,
  GLOBALS_INIT_ENTRY_KEY,
} = require('../build/scripts');

const CWD = process.cwd();

// services/kiln/index.js is intentionally excluded from the splitting bundle.
// It is edit-mode-only code (kiln plugin registration) and is already compiled
// as a self-contained bundle in Pass 2 (_kiln-edit-init, inlineDynamicImports:true).
//
// Including it here would cause Rollup to create a massive shared "kiln chunk"
// that _view-init statically imports — because kiln plugin Vue SFCs reference
// window.kiln.utils.components.X at module scope, this chunk crashes at
// evaluation time in view mode (where clay-kiln-edit.js hasn't run yet and
// window.kiln.utils.components is undefined).
//
// esbuild handles this without issue because its code-splitting doesn't co-locate
// kiln initialisation code with the getDefaultExportFromCjs helper that
// _view-init needs, so the two graphs stay independent.  Rollup merges them.
const ENTRY_GLOBS = [
  path.join(CWD, 'components', '**', 'client.js'),
  path.join(CWD, 'layouts', '**', 'client.js'),
];

const DEST = path.join(CWD, 'public', 'js');
const CLAY_DIR = path.join(CWD, '.clay');

const KILN_EDIT_ENTRY_FILE = path.join(CLAY_DIR, '_kiln-edit-init.js');
const VIEW_INIT_ENTRY_FILE  = path.join(CLAY_DIR, '_view-init.js');
const VIEW_INIT_ENTRY_KEY   = '.clay/_view-init';
const GLOBALS_INIT_ENTRY_FILE = path.join(CLAY_DIR, '_globals-init.js');

// Re-export so index.js (and resolve-media) can use the same key constants.
exports.GLOBALS_INIT_ENTRY_KEY = GLOBALS_INIT_ENTRY_KEY;
exports.VIEW_INIT_ENTRY_KEY = VIEW_INIT_ENTRY_KEY;

const KILN_EDIT_ENTRY_KEY = path.relative(CWD, KILN_EDIT_ENTRY_FILE)
  .replace(/\\/g, '/')
  .replace(/\.js$/, '');

exports.KILN_EDIT_ENTRY_KEY = KILN_EDIT_ENTRY_KEY;

/**
 * Build the shared Rollup input plugins array.
 * Order matters: browser-compat before service-rewrite, both before node-resolve/commonjs.
 * esbuildTransformPlugin runs before commonjs so define substitutions are applied
 * to source code before @rollup/plugin-commonjs converts require() calls.
 *
 * @param {object} [options]
 * @param {object} [overrides] - Optional extra config from rollupConfig hook
 * @returns {Array}
 */
function buildPlugins(options, overrides) {
  // User-defined defines (e.g. DS → window.DS) are merged into the esbuild
  // define map alongside builtins.  esbuild's define is identifier-scoped so
  // it never replaces inside string literals, path segments, or function
  // parameter names — no need for the regex workarounds of the old approach.
  const userDefineMap = (overrides && overrides.define) || {};

  const plugins = [
    missingModulePlugin(),
    browserCompatPlugin(),
    serviceRewritePlugin(),
    vue2Plugin(),
    json(),
    // esbuildTransformPlugin handles:
    //   - builtin defines (process.env.NODE_ENV, __filename, __dirname, process.browser,
    //     process.version, process.versions, global→globalThis)
    //   - user-defined free-variable mappings (DS→window.DS, Eventify→window.Eventify, …)
    //   - in-memory minification via renderChunk (when options.minify is true)
    esbuildTransformPlugin({ minify: options && options.minify, define: userDefineMap }),
    nodeResolve({
      browser: true,
      preferBuiltins: false,
      mainFields: ['browser', 'main', 'module'],
    }),
    commonjs({
      transformMixedEsModules: true,
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
 * @param {object} [options]
 * @returns {object}
 */
function getRollupConfig(options = {}) {
  const config = {
    minify: options.minify || false,
    extraEntries: options.extraEntries || [],
    manualChunksMinSize: 4096,
    define: {},
    plugins: [],
    alias: {},
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
  const entries = ENTRY_GLOBS.flatMap(g => globSync(g));

  if (fs.existsSync(VIEW_INIT_ENTRY_FILE)) {
    entries.push(VIEW_INIT_ENTRY_FILE);
  }

  const existingExtras = extraEntries.filter(f => fs.existsSync(f));

  return [...entries, ...existingExtras];
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
 * Pass 1 — splitting bundle: all component/layout client.js + _view-init
 * Pass 2 — kiln no-split bundle: _kiln-edit-init (single self-contained file)
 * Pass 3 — globals no-split bundle: _globals-init (single self-contained file)
 *
 * Minification (when options.minify is true) is handled in-memory by the
 * esbuildTransformPlugin's renderChunk hook — no post-build disk I/O needed.
 *
 * @param {object} [options]
 * @returns {Promise<void>}
 */
async function buildJS(options = {}) {
  await generateKilnEditEntry();
  await generateViewInitEntry();
  await generateGlobalsInitEntry();

  const rollupConfig = getRollupConfig(options);
  const minChunkSize = rollupConfig.manualChunksMinSize || 4096;

  const entryPoints = getDefaultEntryPoints(rollupConfig.extraEntries);

  if (entryPoints.length === 0) {
    throw new Error(
      'clay vite: no entry points found.\n' +
      'Make sure your project has components/*/client.js or layouts/*/client.js files.'
    );
  }

  await fs.ensureDir(DEST);

  // ── Pass 1: splitting bundle ─────────────────────────────────────────────
  const pass1Bundle = await rollup.rollup({
    input: entriesToInputMap(entryPoints),
    plugins: buildPlugins(options, rollupConfig),
    onwarn: suppressWarning,
  });

  const pass1Output = await pass1Bundle.write({
    format: 'esm',
    dir: DEST,
    entryFileNames: '[name]-[hash].js',
    chunkFileNames: 'chunks/[name]-[hash].js',
    manualChunks: manualChunksPlugin(minChunkSize, CWD),
    sourcemap: true,
  });

  await pass1Bundle.close();

  // ── Pass 2: kiln no-split bundle ─────────────────────────────────────────
  const pass2Bundle = await rollup.rollup({
    input: KILN_EDIT_ENTRY_FILE,
    plugins: buildPlugins(options, rollupConfig),
    onwarn: suppressWarning,
  });

  const pass2Output = await pass2Bundle.write({
    format: 'esm',
    dir: path.join(DEST, '.clay'),
    entryFileNames: '[name]-[hash].js',
    inlineDynamicImports: true,
    sourcemap: true,
  });

  await pass2Bundle.close();

  // ── Pass 3: globals no-split bundle ──────────────────────────────────────
  let pass3Output = null;

  if (fs.existsSync(GLOBALS_INIT_ENTRY_FILE)) {
    const pass3Bundle = await rollup.rollup({
      input: GLOBALS_INIT_ENTRY_FILE,
      plugins: buildPlugins(options, rollupConfig),
      onwarn: suppressWarning,
    });

    pass3Output = await pass3Bundle.write({
      format: 'esm',
      dir: path.join(DEST, '.clay'),
      entryFileNames: '[name]-[hash].js',
      inlineDynamicImports: true,
      sourcemap: true,
    });

    await pass3Bundle.close();
  }

  // ── Merge all output bundles and write _manifest.json ───────────────────
  const mergedBundle = mergeBundles(pass1Output, pass2Output, pass3Output);

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
 * @param {object|null} pass3Output  - Globals no-split bundle (written to DEST/.clay)
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

  await step('media', () => copyMedia());

  if (isTTY) {
    timer = setInterval(() => {
      spinFrame++;
      clearSummary();
      writeSummary();
    }, 80);
  }

  await Promise.all([
    step('js',        ()     => buildJS(options)),
    step('styles',    onProg => buildStyles({ ...options, onProgress: onProg, onError: printError })),
    step('fonts',     ()     => buildFonts()),
    step('templates', onProg => buildTemplates({ ...options, onProgress: onProg })),
    step('vendor',    ()     => copyVendor()),
    step('client-env', ()   => generateClientEnv()),
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

    await generateViewInitEntry();
    await generateGlobalsInitEntry();

    const rollupConfig = getRollupConfig(options);
    const plugins = buildPlugins(options, rollupConfig);
    const minChunkSize = rollupConfig.manualChunksMinSize || 4096;
    const entryPoints = getDefaultEntryPoints(rollupConfig.extraEntries);

    if (entryPoints.length === 0) {
      throw new Error(
        'clay vite: no entry points found.\n' +
        'Make sure your project has components/*/client.js or layouts/*/client.js files.'
      );
    }

    await fs.ensureDir(DEST);

    // Build kiln and globals as one-shot non-splitting bundles upfront.
    // These are only rebuilt when kiln/globals source files change (handled
    // by the JS watcher via rebuildAll below).
    const kilnBundle = await rollup.rollup({
      input: KILN_EDIT_ENTRY_FILE,
      plugins,
      onwarn: suppressWarning,
    });

    const kilnOutput = await kilnBundle.write({
      format: 'esm',
      dir: path.join(DEST, '.clay'),
      entryFileNames: '[name]-[hash].js',
      inlineDynamicImports: true,
      sourcemap: true,
    });

    await kilnBundle.close();

    let globalsOutput = null;

    if (fs.existsSync(GLOBALS_INIT_ENTRY_FILE)) {
      const globalsBundle = await rollup.rollup({
        input: GLOBALS_INIT_ENTRY_FILE,
        plugins,
        onwarn: suppressWarning,
      });

      globalsOutput = await globalsBundle.write({
        format: 'esm',
        dir: path.join(DEST, '.clay'),
        entryFileNames: '[name]-[hash].js',
        inlineDynamicImports: true,
        sourcemap: true,
      });

      await globalsBundle.close();
    }

    // Track latest outputs for manifest merging on each rebuild
    let latestKilnOutput = kilnOutput;
    let latestGlobalsOutput = globalsOutput;

    // Create the rollup watcher for the splitting bundle (Pass 1)
    const watcher = rollup.watch({
      input: entriesToInputMap(entryPoints),
      plugins,
      output: {
        format: 'esm',
        dir: DEST,
        entryFileNames: '[name]-[hash].js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        manualChunks: manualChunksPlugin(minChunkSize, CWD),
        sourcemap: true,
      },
      watch: {
        skipWrite: false,
        exclude: [
          path.join(CWD, 'public', '**'),
          path.join(CWD, 'node_modules', '**'),
        ],
      },
    });

    // Store references for manifest merging
    let currentPass1Bundle = null;

    watcher.on('event', async (event) => {
      if (event.code === 'BUNDLE_START') {
        console.log(clr.changed('[js] Rebuilding...'));
      } else if (event.code === 'BUNDLE_END') {
        if (event.result) {
          currentPass1Bundle = event.result.output
            ? event.result.output.reduce((acc, chunk) => { acc[chunk.fileName] = chunk; return acc; }, {})
            : null;

          // Write merged manifest combining pass1 + kiln + globals
          const merged = mergeBundles(
            currentPass1Bundle ? { output: Object.values(currentPass1Bundle) } : null,
            latestKilnOutput,
            latestGlobalsOutput
          );

          await writeManifest(merged, DEST);

          if (onRebuild) onRebuild([]);
          console.log(clr.rebuilt('[js] Rebuilt successfully'));
        }

        event.result && event.result.close && event.result.close();
      } else if (event.code === 'ERROR') {
        console.error(clr.error(`[js] Build error: ${event.error.message}`));
        if (onRebuild) onRebuild([event.error]);
      }
    });

    return {
      watcher,
      dispose: async () => {
        watcher.close();
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
    VIEW_INIT_ENTRY_FILE,
    GLOBALS_INIT_ENTRY_FILE,
  ];

  const rebuildJs = debounce(async (changedFile, eventType) => {
    if (changedFile) console.log(clr.changed('[js] Changed: ') + clr.file(rel(changedFile)));

    if (eventType !== 'change' && changedFile && changedFile.endsWith('client.js')) {
      await generateViewInitEntry();
    }
    // Rollup watcher picks up file changes automatically via its own internal watcher
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
      const candidates = [
        resolved,
        resolved + '.js',
        path.join(resolved, 'index.js'),
      ];

      const existingFile = candidates.find(c => {
        try {
          return fs.statSync(c).isFile();
        } catch (_) {
          return false;
        }
      });

      if (!existingFile) {
        console.warn(`[rollup] skipping missing module: ${id} (imported from ${path.relative(CWD, realImporter)})`);
        return { id: `\0missing:${id}`, external: false };
      }

      // If the file exists but is empty, redirect to our stub virtual module
      // so `import foo from './empty.js'` doesn't fail with MISSING_EXPORT.
      const content = fs.readFileSync(existingFile, 'utf8').trim();

      if (!content) {
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

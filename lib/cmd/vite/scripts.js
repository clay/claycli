'use strict';

// Suppress Vite CJS deprecation warning — we use require() because claycli
// is a CJS package. Vite 5 still ships a fully-functional CJS build.
process.env.VITE_CJS_IGNORE_WARNING = 'true';

const vite = require('vite');
const fs = require('fs-extra');
const path = require('path');
const { globSync } = require('glob');

const { getConfigValue } = require('../../config-file-helpers');
const viteBrowserCompatPlugin = require('./plugins/browser-compat');
const viteServiceRewritePlugin = require('./plugins/service-rewrite');
const viteMissingModulePlugin = require('./plugins/missing-module');
const viteVue2Plugin = require('./plugins/vue2');
const viteManualChunksPlugin = require('./plugins/manual-chunks');

const { generateViteBootstrap, VITE_BOOTSTRAP_FILE, VITE_BOOTSTRAP_KEY } = require('./generate-bootstrap');
const { generateViteKilnEditEntry, KILN_EDIT_ENTRY_FILE, KILN_EDIT_ENTRY_KEY } = require('./generate-kiln-edit');
const { generateViteGlobalsInit } = require('./generate-globals-init');

const { buildStyles, SRC_GLOBS: STYLE_GLOBS } = require('../build/styles');
const { buildFonts, FONTS_SRC_GLOB } = require('../build/fonts');
const { buildTemplates, TEMPLATE_GLOB_PATTERN } = require('../build/templates');
const { copyVendor } = require('../build/vendor');
const { copyMedia } = require('../build/media');

const CWD = process.cwd();
const DEST = path.join(CWD, 'public', 'js');
const CLAY_DIR = path.join(CWD, '.clay');

exports.VITE_BOOTSTRAP_KEY = VITE_BOOTSTRAP_KEY;
exports.KILN_EDIT_ENTRY_KEY = KILN_EDIT_ENTRY_KEY;

// ── Config helpers ──────────────────────────────────────────────────────────

/**
 * Read and apply the viteConfig() customizer from claycli.config.js.
 *
 * The config object shape:
 *   {
 *     minify:          false,
 *     extraEntries:    [],
 *     minChunkSize:    8192,   // bytes — modules below this are inlined or bucketed
 *     kilnSplit:       false,  // set true once all model.js/kiln.js files are ESM —
 *                              // enables Rollup splitting for the kiln edit bundle,
 *                              // collapsing the two-pass build into a single graph
 *     define:          {},     // merged on top of built-in defines
 *     plugins:         [],     // extra Vite plugins (appended after built-ins)
 *     commonjsExclude: [],     // extra patterns passed to @rollup/plugin-commonjs `exclude`.
 *                              // Use this to exempt pre-bundled webpack packages (e.g.
 *                              // those that use eval()-based internal module systems) from
 *                              // CJS transformation, since wrapping them breaks their
 *                              // internal eval() scope.
 *                              // Example: [/node_modules\/pyxis-frontend\//]
 *   }
 *
 * @param {object} [cliOptions]
 * @returns {object}
 */
function getViteConfig(cliOptions = {}) {
  const config = {
    minify:          cliOptions.minify || false,
    extraEntries:    cliOptions.extraEntries || [],
    minChunkSize:    8192,
    kilnSplit:       false,
    define:          {},
    plugins:         [],
    commonjsExclude: [],
  };

  const customizer = getConfigValue('viteConfig');

  if (typeof customizer === 'function') {
    const customized = customizer(config);

    if (customized && typeof customized === 'object') return customized;
  }

  return config;
}

exports.getViteConfig = getViteConfig;

/**
 * Build the defines map for Vite.
 * Vite's define uses esbuild under the hood in production and is
 * identifier-scoped (never replaces inside string literals).
 *
 * @param {object} userDefines - extra defines from viteConfig
 * @returns {object}
 */
function buildDefines(userDefines = {}) {
  const NODE_ENV = process.env.NODE_ENV || 'development';

  return Object.assign(
    {
      'process.env.NODE_ENV': JSON.stringify(NODE_ENV),
      'process.browser':      JSON.stringify(true),
      'process.version':      JSON.stringify(''),
      'process.versions':     JSON.stringify({}),
      '__filename':            JSON.stringify(''),
      '__dirname':             JSON.stringify('/'),
      'global':               'globalThis',
    },
    userDefines
  );
}

/**
 * Assemble the Vite plugin array for a build pass.
 *
 * Order matters:
 *   1. browser-compat  — intercepts Node built-ins before Vite's resolver
 *   2. service-rewrite — redirects services/server → client before resolution
 *   3. missing-module  — stubs missing project files to prevent hard errors
 *   4. vue2            — compiles .vue SFCs (must run before Vite's JS pipeline)
 *   5. user plugins    — appended from viteConfig.plugins
 *
 * CJS transformation is handled by Vite's single built-in @rollup/plugin-commonjs
 * instance, configured via build.commonjsOptions in baseViteConfig().  Running a
 * second commonjs instance here would conflict because both instances maintain
 * separate internal virtual-module state (?commonjs-proxy, ?commonjs-wrapped, etc.),
 * leaving require() calls untransformed in the final browser bundle.
 *
 * @param {object[]} [extraPlugins]
 * @returns {object[]}
 */
function buildPlugins(extraPlugins = []) {
  return [
    viteBrowserCompatPlugin(),
    viteServiceRewritePlugin(),
    viteMissingModulePlugin(),
    viteVue2Plugin(),
    ...extraPlugins,
  ];
}

// ── Manifest ────────────────────────────────────────────────────────────────

/**
 * Build _manifest.json content from one or two Vite RollupOutputs.
 *
 * viewOutput  — the splitting pass (bootstrap + component chunks)
 * kilnOutput  — the single-file kiln edit pass (may be null)
 *
 * Produces the same { key: { file, imports } } shape as the esbuild and
 * Rollup pipelines so resolve-media.js works identically.
 *
 * @param {import('rollup').RollupOutput|null} viewOutput
 * @param {import('rollup').RollupOutput|null} kilnOutput
 * @param {string} publicBase
 * @returns {object}
 */
function buildManifest(viewOutput, kilnOutput = null, publicBase = '/js') {
  const manifest = {};

  for (const output of [viewOutput, kilnOutput]) {
    for (const chunk of (output ? output.output : [])) {
      if (chunk.type !== 'chunk' || !chunk.isEntry) continue;

      const facadeId = chunk.facadeModuleId;

      if (!facadeId) continue;

      const cleanFacadeId = facadeId.replace(/\?.*$/, '');
      const entryKey = path.relative(CWD, cleanFacadeId)
        .replace(/\\/g, '/')
        .replace(/\.js$/, '');

      const fileUrl    = `${publicBase}/${chunk.fileName.replace(/\\/g, '/')}`;
      const importUrls = (chunk.imports || []).map(imp => `${publicBase}/${imp.replace(/\\/g, '/')}`);

      manifest[entryKey] = { file: fileUrl, imports: importUrls };
    }
  }

  return manifest;
}

async function writeManifest(manifest) {
  const manifestPath = path.join(DEST, '_manifest.json');

  await fs.outputJson(manifestPath, manifest, { spaces: 2 });
}

// ── Vite build config factory ────────────────────────────────────────────────

/**
 * Return a base Vite config object.  Common settings shared by both build
 * passes (splitting and no-split).
 *
 * @param {object} viteCfg   — result of getViteConfig()
 * @returns {object}
 */
function baseViteConfig(viteCfg) {
  // The public base path must match the URL prefix under which public/js/ is
  // served.  Vite uses this to generate the L() helper inside the bootstrap:
  //   const L = function(t){ return "/js/" + t }
  // Without base:'/js/', L prepends just '/', making preload links land at
  // /chunks/… (404) instead of the correct /js/chunks/… path.
  const publicBase = (viteCfg.publicBase || '/js').replace(/\/$/, '');

  return {
    root:       CWD,
    base:       publicBase + '/',
    configFile: false, // never read vite.config.js
    logLevel:   'warn',
    plugins:    buildPlugins(viteCfg.plugins),
    define:     buildDefines(viteCfg.define),
    resolve: {
      browserField: true,
      mainFields:   ['browser', 'main', 'module'],
    },
    // Disable dep pre-bundling — Rollup handles all modules directly.
    // Vite 5.1+ replaced `optimizeDeps.disabled` with noDiscovery + empty include.
    optimizeDeps: { noDiscovery: true, include: [] },
    build: {
      target:       'es2017',
      outDir:       DEST,
      emptyOutDir:  false,
      sourcemap:    true,
      minify:       viteCfg.minify ? 'esbuild' : false,
      cssCodeSplit: false, // our vue2 plugin handles CSS
      // Suppress the publicDir warning — we use outDir inside public/ intentionally.
      copyPublicDir: false,
      // Configure Vite's single built-in @rollup/plugin-commonjs to cover ALL JS files
      // (not just node_modules) plus .vue files, whose <script> blocks may contain
      // require() calls after the Vue2 plugin transforms them.
      //
      // Two checks both need to pass in @rollup/plugin-commonjs:
      //   - include regex  (createFilter check)
      //   - extensions     (path.extname check)
      //
      // Using TWO separate commonjs instances (one in plugins[], one built-in) causes
      // conflicts because each maintains its own internal virtual-module state — files
      // processed by one instance produce ?commonjs-* virtual modules the other doesn't
      // recognise, so require() calls survive into the browser bundle unchanged.
      //
      // transformMixedEsModules is required here because our viteVue2Plugin always
      // appends `export default __sfc__` to every .vue file regardless of whether
      // the original <script> block used require()/module.exports or ESM.  The
      // resulting output is always "mixed" (CJS require() + ESM export default), so
      // without this flag the CJS plugin would skip the require() transform and leave
      // bare require() calls in the browser bundle.
      //
      // For plain .js files, mixing require() and import/export in the same file
      // is prohibited — files must be pure CJS or pure ESM (enforced via ESLint).
      commonjsOptions: {
        include:                 /\.(js|cjs|vue)$/,
        extensions:              ['.js', '.cjs', '.vue'],
        transformMixedEsModules: true,           // needed for .vue files (see note above)
        requireReturnsDefault:   'preferred',    // match rollup pipeline: x.fn not x.default.fn
        // Sites can supply additional excludes via commonjsExclude in viteConfig().
        // Useful for pre-bundled webpack packages (eval()-based internal modules) that
        // break when CJS-transformed; the knowledge of which packages those are belongs
        // with the site, not with claycli.
        exclude:                 viteCfg.commonjsExclude || [],
      },
    },
  };
}

// ── Build passes ────────────────────────────────────────────────────────────

/**
 * Pass 1 — view mode (splitting).
 *
 * Only the bootstrap entry is included here when kilnSplit is false (default).
 * When kilnSplit is true (all model.js/kiln.js files are ESM), the kiln entry
 * is added to this same graph — Rollup can then tree-shake and scope-hoist
 * across both trees, making the shared-dep pollution problem disappear.
 *
 * @param {object} viteCfg
 * @returns {Promise<import('rollup').RollupOutput>}
 */
async function runViewBuild(viteCfg) {
  const entryMap = {};

  entryMap[VITE_BOOTSTRAP_KEY] = VITE_BOOTSTRAP_FILE;

  if (viteCfg.kilnSplit) {
    entryMap[KILN_EDIT_ENTRY_KEY] = KILN_EDIT_ENTRY_FILE;
  }

  for (const extraPath of (viteCfg.extraEntries || [])) {
    if (fs.existsSync(extraPath)) {
      const key = path.relative(CWD, extraPath).replace(/\\/g, '/').replace(/\.js$/, '');

      entryMap[key] = extraPath;
    }
  }

  const cfg = baseViteConfig(viteCfg);

  cfg.build.rollupOptions = {
    input:  entryMap,
    output: {
      format:         'esm',
      entryFileNames: '[name]-[hash].js',
      chunkFileNames: 'chunks/[name]-[hash].js',
      manualChunks:   viteManualChunksPlugin(viteCfg.minChunkSize || 8192, CWD),
    },
    onwarn: suppressWarning,
  };

  const result = await vite.build(cfg);

  return Array.isArray(result) ? result[0] : result;
}

/**
 * Pass 2 — kiln edit mode, no-split fallback.
 *
 * Used when kilnSplit is false (default, CJS model.js files). The kiln-edit-init
 * entry imports every component model.js and kiln.js. Because CJS modules cannot
 * be tree-shaken, their shared utility imports pollute the view-mode chunk graph.
 * Isolating kiln into a separate pass with inlineDynamicImports:true avoids that
 * pollution entirely — identical to how the esbuild pipeline built the kiln bundle.
 *
 * Once all model.js and kiln.js files are ESM, set kilnSplit:true in viteConfig()
 * to collapse back to a single pass and enable proper kiln chunk splitting.
 *
 * @param {object} viteCfg
 * @returns {Promise<import('rollup').RollupOutput>}
 */
async function runKilnBuild(viteCfg) {
  const cfg = baseViteConfig(viteCfg);

  cfg.build.rollupOptions = {
    input:  { [KILN_EDIT_ENTRY_KEY]: KILN_EDIT_ENTRY_FILE },
    output: {
      format:               'esm',
      entryFileNames:       '[name]-[hash].js',
      inlineDynamicImports: true,
      // With inlineDynamicImports:true Rollup inlines ALL module code in dependency
      // order.  Kiln plugin .vue files (e.g. glaze-product/modal.vue) access
      // window.kiln.config.pyxis and window.kiln.utils.* at MODULE-EVALUATION time
      // (top-level const/var lines), before _initKilnPlugins() runs at the end of
      // the bundle.  The banner is injected before any module code and ensures those
      // globals are at least empty objects so destructuring doesn't throw.
      // _initKilnPlugins() will replace them with real values later in the same tick.
      banner: [
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
      ].join('\n'),
    },
    onwarn: suppressWarning,
  };

  const result = await vite.build(cfg);

  return Array.isArray(result) ? result[0] : result;
}

// ── JS build orchestrator ────────────────────────────────────────────────────

/**
 * Generate all entry files then run both build passes in parallel.
 * When kilnSplit is true (ESM model files), the kiln entry is included in
 * the view-mode graph and no separate kiln pass is needed.
 * Writes _manifest.json with merged output from both passes.
 *
 * @param {object} [options]
 * @returns {Promise<void>}
 */
async function buildJS(options = {}) {
  await generateViteGlobalsInit();
  await generateViteKilnEditEntry();
  await generateViteBootstrap();

  if (!fs.existsSync(VITE_BOOTSTRAP_FILE)) {
    throw new Error('clay vite: missing .clay/vite-bootstrap.js after prepare.');
  }

  await fs.ensureDir(DEST);

  const viteCfg = getViteConfig(options);

  let viewOutput, kilnOutput;

  if (viteCfg.kilnSplit) {
    // Single pass — kiln is in the same Rollup graph as the bootstrap.
    // Only safe once all model.js/kiln.js files are ESM.
    viewOutput = await runViewBuild(viteCfg);
    kilnOutput = null;
  } else {
    // Two passes in parallel — kiln isolated to prevent CJS dep pollution
    // of the view-mode chunk graph.
    [viewOutput, kilnOutput] = await Promise.all([
      runViewBuild(viteCfg),
      runKilnBuild(viteCfg),
    ]);
  }

  const manifest = buildManifest(viewOutput, kilnOutput);

  await writeManifest(manifest);
}

exports.buildJS = buildJS;

// ── Full build (JS + assets in parallel) ────────────────────────────────────

/**
 * Run all build steps: JS + styles + fonts + templates + vendor + media.
 *
 * @param {object} [options]
 * @returns {Promise<void>}
 */
async function buildAll(options = {}) {
  const isTTY = process.stdout.isTTY;
  const SPINNER = ['⠋','⠙','⠹','⠸','⠼','⠴','⠦','⠧','⠇','⠏'];

  const clr = {
    label:   s => `\x1b[36m${s}\x1b[0m`,
    done:    s => `\x1b[32m${s}\x1b[0m`,
    fail:    s => `\x1b[31m${s}\x1b[0m`,
    time:    s => `\x1b[90m${s}\x1b[0m`,
    spin:    s => `\x1b[33m${s}\x1b[0m`,
  };

  const states = new Map();
  const totalStart = Date.now();
  let spinFrame = 0;
  let timer = null;
  let progressUp = false;

  function clearSummary() {
    if (isTTY && progressUp) { process.stdout.write('\r\x1b[2K'); progressUp = false; }
  }

  function writeSummary() {
    if (!isTTY) return;
    const running = [...states.entries()].filter(([, s]) => !s.done);

    if (!running.length) return;

    const spin  = clr.spin(SPINNER[spinFrame % SPINNER.length]);
    const parts = running.map(([l]) => clr.label(`[${l}]`));
    const total = ((Date.now() - totalStart) / 1000).toFixed(1);

    process.stdout.write(`${spin} ${parts.join(' ')} ${clr.time(`(${total}s)`)}`);
    progressUp = true;
  }

  function startStep(label) {
    states.set(label, { start: Date.now(), done: false, error: false });
    if (!isTTY) process.stdout.write(`  ${clr.label(`[${label}]`)} starting...\n`);
  }

  function finishStep(label, error = false) {
    const s = states.get(label);

    if (s) { s.done = true; s.error = error; s.elapsed = ((Date.now() - s.start) / 1000).toFixed(1); }

    const icon = error ? clr.fail('✗') : clr.done('✓');
    const word = error ? 'failed' : 'done  ';

    if (isTTY) {
      clearSummary();
      process.stdout.write(`${icon} ${clr.label(`[${label}]`)} ${word} ${clr.time(`(${s ? s.elapsed : '?'}s)`)}\n`);

      if ([...states.values()].every(v => v.done)) { clearInterval(timer); timer = null; }
      else writeSummary();
    } else {
      process.stdout.write(`${icon} ${clr.label(`[${label}]`)} ${word} ${clr.time(`(${s ? s.elapsed : '?'}s)`)}\n`);
    }
  }

  function step(label, fn) {
    startStep(label);
    return fn()
      .then(() => finishStep(label))
      .catch(e => {
        process.stderr.write(`\n${clr.fail('[error]')} ${clr.label(label)}: ${e.message}\n`);
        finishStep(label, true);
      });
  }

  process.stdout.write('\nBuilding assets...\n');

  await step('media', () => copyMedia());

  if (isTTY) {
    timer = setInterval(() => { spinFrame++; clearSummary(); writeSummary(); }, 80);
  }

  await Promise.all([
    step('js',         () => buildJS(options)),
    step('styles',     () => buildStyles(options)),
    step('fonts',      () => buildFonts()),
    step('templates',  () => buildTemplates(options)),
    step('vendor',     () => copyVendor()),
  ]);

  if (timer) { clearInterval(timer); timer = null; }
  clearSummary();

  const totalSecs = ((Date.now() - totalStart) / 1000).toFixed(1);

  process.stdout.write(`\n${clr.done('Build complete')} ${clr.time(`(${totalSecs}s total)`)}\n\n`);
}

/**
 * One-shot production build.
 *
 * @param {object} [options]
 */
async function build(options = {}) {
  return buildAll(options);
}

exports.build = build;
exports.buildAll = buildAll;

// ── Watch mode ───────────────────────────────────────────────────────────────

/**
 * Start file watchers for CSS, fonts, and templates using chokidar,
 * and a Vite/Rollup watcher for JS.
 *
 * On every JS change: regenerate entries if needed, then Rollup rebuilds
 * only the affected modules (incremental).
 *
 * @param {object}   [options]
 * @param {boolean}  [options.minify=false]
 * @param {string[]} [options.extraEntries=[]]
 * @param {function} [options.onRebuild]  called after each JS rebuild with (errors)
 * @returns {Promise<{dispose: function}>}
 */
async function watch(options = {}) {
  const { onRebuild } = options;
  const chokidar = require('chokidar');

  const chokidarOpts = {
    ignoreInitial: true,
    usePolling:    true,
    interval:      100,
    awaitWriteFinish: { stabilityThreshold: 50, pollInterval: 50 },
  };

  function debounce(fn, ms) {
    let t;

    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  }

  function rel(p) { return path.relative(CWD, p); }

  const clr = {
    changed: s => `\x1b[33m${s}\x1b[0m`,
    rebuilt: s => `\x1b[32m${s}\x1b[0m`,
    file:    s => `\x1b[36m${s}\x1b[0m`,
    error:   s => `\x1b[31m${s}\x1b[0m`,
  };

  // ── JS watch via Vite/Rollup watch mode ────────────────────────────────────

  const viteCfg = getViteConfig(options);

  await generateViteGlobalsInit();
  await generateViteKilnEditEntry();
  await generateViteBootstrap();
  await fs.ensureDir(DEST);

  // In two-pass mode (default, CJS models): build kiln once up-front and
  // rebuild it on-demand when model.js/kiln.js files change.
  // In kilnSplit mode (ESM models): kiln is part of the single watcher graph.
  let kilnOutput = null;

  if (!viteCfg.kilnSplit) {
    kilnOutput = await runKilnBuild(viteCfg);
  }

  const watchInput = viteCfg.kilnSplit
    ? { [VITE_BOOTSTRAP_KEY]: VITE_BOOTSTRAP_FILE, [KILN_EDIT_ENTRY_KEY]: KILN_EDIT_ENTRY_FILE }
    : { [VITE_BOOTSTRAP_KEY]: VITE_BOOTSTRAP_FILE };

  // Rollup watcher for the view-mode graph (+ kiln when kilnSplit is on).
  const watchCfg = baseViteConfig(viteCfg);

  watchCfg.build.outDir = DEST;
  watchCfg.build.watch = {};
  watchCfg.build.rollupOptions = {
    input:  watchInput,
    output: {
      format:         'esm',
      entryFileNames: '[name]-[hash].js',
      chunkFileNames: 'chunks/[name]-[hash].js',
      manualChunks:   viteManualChunksPlugin(viteCfg.minChunkSize || 8192, CWD),
    },
    onwarn: suppressWarning,
    watch: {
      exclude: [
        path.join(CWD, 'public', '**'),
        path.join(CWD, 'node_modules', '**'),
        path.join(CLAY_DIR, '**'),
      ],
    },
  };

  const watcher = await vite.build(watchCfg);

  watcher.on('event', async (event) => {
    if (event.code === 'BUNDLE_START') {
      console.log(clr.changed('[js] Rebuilding...'));
    } else if (event.code === 'BUNDLE_END') {
      const output = event.result;
      const viewOutput = output ? { output: (output.output || []) } : null;
      const manifest = buildManifest(viewOutput, kilnOutput);

      await writeManifest(manifest);

      if (onRebuild) onRebuild([]);
      console.log(clr.rebuilt('[js] Rebuilt successfully'));

      if (event.result && event.result.close) event.result.close();
    } else if (event.code === 'ERROR') {
      console.error(clr.error(`[js] Build error: ${event.error.message}`));
      if (onRebuild) onRebuild([event.error]);
    }
  });

  // ── Chokidar: regenerate bootstrap when new client.js files appear ─────────

  // Separate debounced kiln rebuilder — only used in two-pass mode (kilnSplit:false).
  // In kilnSplit mode the Rollup watcher picks up model.js changes automatically.
  const rebuildKilnDebounced = debounce(async () => {
    if (viteCfg.kilnSplit) return;

    try {
      await generateViteKilnEditEntry();
      kilnOutput = await runKilnBuild(viteCfg);
      console.log(clr.rebuilt('[kiln] Rebuilt'));
    } catch (e) {
      console.error(clr.error(`[kiln] Rebuild failed: ${e.message}`));
    }
  }, 200);

  const rebuildBootstrap = debounce(async (changedFile, eventType) => {
    if (!changedFile) return;

    console.log(clr.changed('[js] Changed: ') + clr.file(rel(changedFile)));

    const isNewClientJs = eventType !== 'change' && changedFile.endsWith('client.js');
    const isGlobal      = changedFile.includes(`${path.sep}global${path.sep}`);

    if (isNewClientJs || isGlobal) await generateViteBootstrap();

    const isKilnFile = changedFile.endsWith('model.js') || changedFile.endsWith('kiln.js');

    if (isKilnFile) rebuildKilnDebounced();
  }, 200);

  const JS_GLOBS = [
    path.join(CWD, 'components', '**', '*.js'),
    path.join(CWD, 'components', '**', '*.vue'),
    path.join(CWD, 'layouts', '**', '*.js'),
    path.join(CWD, 'global', '**', '*.js'),
    path.join(CWD, 'services', '**', '*.js'),
  ];

  const jsWatcher = chokidar.watch(JS_GLOBS, {
    ...chokidarOpts,
    ignored: [path.join(CWD, 'public', '**'), path.join(CWD, 'node_modules', '**')],
  });

  jsWatcher
    .on('change', f => rebuildBootstrap(f, 'change'))
    .on('add',    f => rebuildBootstrap(f, 'add'))
    .on('unlink', f => rebuildBootstrap(f, 'unlink'));

  // ── CSS watcher ─────────────────────────────────────────────────────────────
  const rebuildStyles = debounce((changedFile) => {
    if (changedFile) console.log(clr.changed('[styles] Changed: ') + clr.file(rel(changedFile)));

    return buildStyles(options)
      .then(() => console.log(clr.rebuilt('[styles] Rebuilt')))
      .catch(e => console.error(clr.error(`[styles] rebuild failed: ${e.message}`)));
  }, 200);

  const cssWatcher = chokidar.watch(STYLE_GLOBS, chokidarOpts);

  cssWatcher.on('change', rebuildStyles).on('add', rebuildStyles).on('unlink', rebuildStyles);

  // ── Font watcher ────────────────────────────────────────────────────────────
  const rebuildFonts = debounce((changedFile) => {
    if (changedFile) console.log(clr.changed('[fonts] Changed: ') + clr.file(rel(changedFile)));

    return buildFonts()
      .then(() => console.log(clr.rebuilt('[fonts] Rebuilt')))
      .catch(e => console.error(clr.error(`[fonts] rebuild failed: ${e.message}`)));
  }, 200);

  const fontWatcher = chokidar.watch(FONTS_SRC_GLOB, chokidarOpts);

  fontWatcher.on('change', rebuildFonts).on('add', rebuildFonts).on('unlink', rebuildFonts);

  // ── Template watcher ────────────────────────────────────────────────────────
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

  templateWatcher
    .on('change', rebuildTemplates)
    .on('add', rebuildTemplates)
    .on('unlink', rebuildTemplates);

  // Wait for all chokidar watchers to finish initial scan
  const chokidarWatchers = [jsWatcher, cssWatcher, fontWatcher, templateWatcher];

  await Promise.all(chokidarWatchers.map(w => new Promise(resolve => w.once('ready', resolve))));

  return {
    dispose: async () => {
      if (watcher && watcher.close) watcher.close();
      await Promise.all(chokidarWatchers.map(w => w.close()));
    },
  };
}

exports.watch = watch;

// ── Warning suppressor ───────────────────────────────────────────────────────

/**
 * Suppress Rollup warnings that are expected when bundling a CJS-heavy
 * codebase through the ESM pipeline.
 *
 * @param {object}   warning
 * @param {function} warn
 */
function suppressWarning(warning, warn) {
  if (warning.code === 'CIRCULAR_DEPENDENCY')  return;
  if (warning.code === 'THIS_IS_UNDEFINED')    return;
  if (warning.code === 'MISSING_GLOBAL_NAME')  return;
  if (warning.code === 'UNRESOLVED_IMPORT')    return;
  if (warning.code === 'MISSING_EXPORT')       return;
  if (warning.code === 'EVAL' && warning.id && warning.id.includes('/node_modules/')) return;

  warn(warning);
}

'use strict';

const esbuild = require('esbuild');
const fs = require('fs-extra');
const { globSync } = require('glob');
const path = require('path');

const { getConfigValue } = require('../../config-file-helpers');
const browserCompatPlugin = require('./plugins/browser-compat');
const serviceRewritePlugin = require('./plugins/service-rewrite');
const vue2Plugin = require('./plugins/vue2');
const { writeManifest } = require('./manifest');
const { buildStyles, SRC_GLOBS: STYLE_GLOBS } = require('./styles');
const { buildFonts, FONTS_SRC_GLOB } = require('./fonts');
const { buildTemplates, TEMPLATE_GLOB_PATTERN } = require('./templates');
const { copyVendor } = require('./vendor');
const { copyMedia } = require('./media');

const CWD = process.cwd();

// Mirror the same glob patterns used by the Browserify compile pipeline.
// global/js/*.js is included so that global scripts (ads, aaa-module-mounting,
// cid, facebook, etc.) are compiled as individual entry points and appear in
// the manifest — without needing a hand-rolled init.js to import them.
const ENTRY_GLOBS = [
  path.join(CWD, 'components', '**', 'client.js'),
  path.join(CWD, 'components', '**', 'model.js'),
  path.join(CWD, 'layouts', '**', 'client.js'),
  path.join(CWD, 'layouts', '**', 'model.js'),
  path.join(CWD, 'services', 'kiln', 'index.js'),
  path.join(CWD, 'global', 'js', '*.js'),
];

const DEST = path.join(CWD, 'public', 'js');

// .clay/ is the generated-file directory, shared with _kiln-edit-init.js.
const CLAY_DIR = path.join(CWD, '.clay');

// Generated entry file that pre-populates window.kiln.componentModels,
// window.kiln.componentKilnjs, and calls the kiln plugin initializer so
// that clay-kiln's preload action finds everything it needs without the
// Browserify window.modules / window.require runtime.
const KILN_EDIT_ENTRY_DIR = CLAY_DIR;
const KILN_EDIT_ENTRY_FILE = path.join(CLAY_DIR, '_kiln-edit-init.js');

// Generated view-mode init: sticky custom-event shim + component mounting.
// Replaces the webpack-era components/init.js that sites should not own.
const VIEW_INIT_ENTRY_FILE = path.join(CLAY_DIR, '_view-init.js');
const VIEW_INIT_ENTRY_KEY  = '.clay/_view-init';

/**
 * Generate the kiln edit-mode aggregator entry.
 *
 * Creates `.clay/_kiln-edit-init.js` which:
 *  1. Imports every component/layout model.js and registers it in
 *     window.kiln.componentModels so clay-kiln can find it without
 *     the Browserify window.modules registry.
 *  2. Does the same for kiln.js files → window.kiln.componentKilnjs.
 *  3. Imports services/kiln/index.js (if present) and calls it immediately,
 *     replicating the side-effect that the Browserify pluginInitializer() had.
 *
 * Because ESM <script type="module"> tags are deferred and execute before
 * DOMContentLoaded, this bundle runs before clay-kiln's preload action fires,
 * ensuring the registries are populated in time.
 *
 * @returns {Promise<string>} absolute path to the generated file
 */
async function generateKilnEditEntry() {
  const modelFiles = [
    ...globSync(path.join(CWD, 'components', '**', 'model.js')),
    ...globSync(path.join(CWD, 'layouts', '**', 'model.js')),
  ];
  const kilnjsFiles = [
    ...globSync(path.join(CWD, 'components', '**', 'kiln.js')),
    ...globSync(path.join(CWD, 'layouts', '**', 'kiln.js')),
  ];
  const kilnPluginFile = path.join(CWD, 'services', 'kiln', 'index.js');
  const hasKilnPlugin = fs.existsSync(kilnPluginFile);

  const toRel = (absPath) => {
    const rel = path.relative(KILN_EDIT_ENTRY_DIR, absPath).replace(/\\/g, '/');

    return rel.startsWith('.') ? rel : `./${rel}`;
  };

  const lines = [];

  // All imports must come first in an ES module.
  modelFiles.forEach((f, i) => lines.push(`import _m${i} from ${JSON.stringify(toRel(f))};`));
  kilnjsFiles.forEach((f, i) => lines.push(`import _k${i} from ${JSON.stringify(toRel(f))};`));
  if (hasKilnPlugin) {
    lines.push(`import _initKilnPlugins from ${JSON.stringify(toRel(kilnPluginFile))};`);
  }

  lines.push('');
  lines.push('window.kiln = window.kiln || {};');

  // Register models
  lines.push('window.kiln.componentModels = window.kiln.componentModels || {};');
  modelFiles.forEach((f, i) => {
    const name = path.basename(path.dirname(f));

    lines.push(`window.kiln.componentModels[${JSON.stringify(name)}] = _m${i};`);
  });

  // Register kiln.js files
  lines.push('window.kiln.componentKilnjs = window.kiln.componentKilnjs || {};');
  kilnjsFiles.forEach((f, i) => {
    const name = path.basename(path.dirname(f));

    lines.push(`window.kiln.componentKilnjs[${JSON.stringify(name)}] = _k${i};`);
  });

  // Initialise the site kiln plugin (replaces the Browserify pluginInitializer() call)
  if (hasKilnPlugin) {
    lines.push('_initKilnPlugins();');
  }

  await fs.ensureDir(CLAY_DIR);
  await fs.writeFile(KILN_EDIT_ENTRY_FILE, lines.join('\n'), 'utf8');

  return KILN_EDIT_ENTRY_FILE;
}

/**
 * Generate the view-mode client-script initialiser.
 *
 * Creates `.clay/_view-init.js` which:
 *
 *  1. Installs a sticky custom-event shim on `window.addEventListener` so that
 *     late subscribers to events like `auth:init` receive an immediate replay.
 *     This restores the Browserify guarantee — all `window.addEventListener`
 *     calls work regardless of ESM dynamic-import load order — without
 *     touching `auth.js` or any `client.js` file in the consuming repo.
 *
 *  2. Mounts Clay components on the page by iterating `[data-uri]` elements
 *     and dynamically importing each component's `client.js`.  Supports both
 *     patterns used in the codebase:
 *       - Function-export: default export is called with the DOM element.
 *       - Dollar-Slice controller: `DS.controller()` is called as a side-effect;
 *         the controller is then instantiated via `DS.get(name, element)`.
 *         `window.DS` is expected to be set by `aaa-module-mounting.js`, which
 *         runs synchronously before component imports resolve because it is
 *         loaded via a GLOBAL_KEYS `<script type="module">` tag that appears
 *         after this entry in the HTML.
 *
 * The consuming repo does NOT need to maintain a `components/init.js` file.
 * This generator owns that responsibility — the same way `_kiln-edit-init.js`
 * owns the kiln model/plugin aggregation.
 *
 * @returns {Promise<string>} absolute path to the generated file
 */
async function generateViewInitEntry() {
  const componentClientFiles = globSync(path.join(CWD, 'components', '**', 'client.js'));

  const toRel = (absPath) => {
    const rel = path.relative(CLAY_DIR, absPath).replace(/\\/g, '/');

    return rel.startsWith('.') ? rel : `./${rel}`;
  };

  // Build the explicit component module map.
  // Explicit static imports (rather than dynamic template literals) let esbuild
  // resolve content-hashed output filenames at build time, so the browser can
  // load the correct chunk without a runtime import-map.
  const moduleEntries = componentClientFiles.map(f => {
    const key = path.relative(CWD, f).replace(/\\/g, '/'); // 'components/article/client.js'

    return `  ${JSON.stringify(key)}: () => import(${JSON.stringify(toRel(f))})`;
  }).join(',\n');

  const content = `\
// AUTO-GENERATED by clay build — DO NOT EDIT.
// Generated: ${new Date().toISOString()}

// ── Sticky custom-event shim ──────────────────────────────────────────────────
// Installed synchronously as the very first code this entry point runs so it is
// in place before any component module loads or any global script fires an event.
// Makes window.addEventListener(type, handler) safe against ESM dynamic-import
// race conditions: if the event has already fired, the handler is replayed in the
// next microtask.  No changes to auth.js or any client.js are required.
;(function clayPackNextStickyEvents() {
  var fired = {};
  var _orig = window.addEventListener.bind(window);

  window.addEventListener = function (type, handler, options) {
    _orig(type, handler, options);

    if (Object.prototype.hasOwnProperty.call(fired, type)) {
      Promise.resolve().then(function () {
        handler(new CustomEvent(type, { detail: fired[type] }));
      });
    }
  };

  // Add event names here to make them sticky.
  _orig('auth:init', function (ev) { fired['auth:init'] = ev.detail; });
}());

// ── Component module registry ─────────────────────────────────────────────────
// Explicit static imports let esbuild resolve hashed output paths at build time
// so the browser can load the correct file without a runtime import-map.
var _clayClientModules = {
${moduleEntries}
};

// ── Component mounting ────────────────────────────────────────────────────────
// Mirrors the Browserify _client-init behaviour:
//   1. Pre-load every component that appears in Clay's HTML comment nodes.
//   2. For each [data-uri] element, import its client.js and:
//        a. If the module exports a function → call it with the element.
//        b. If it registers a Dollar-Slice controller (no default export) →
//           instantiate it via DS.get(name, element).
//           window.DS is set by aaa-module-mounting.js, which runs as a
//           separate <script type="module"> before async imports resolve.
var CLAY_INSTANCE_KIND = /_components\\/(.+?)(\\/instances|$)/;

function mountComponentModules() {
  performance.mark('clay-components-start');

  return new Promise(function (resolve) {
    var iterator = document.createNodeIterator(
      document.documentElement,
      NodeFilter.SHOW_COMMENT,
      function (node) {
        return node.nodeValue && node.nodeValue.indexOf('_components/') !== -1
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_SKIP;
      }
    );

    var node, preloads = [];

    while ((node = iterator.nextNode())) {
      var pm = node.nodeValue.match(CLAY_INSTANCE_KIND);

      if (pm) {
        var preloadKey = 'components/' + pm[1] + '/client.js';

        if (_clayClientModules[preloadKey]) {
          preloads.push(_clayClientModules[preloadKey]());
        }
      }
    }

    resolve(Promise.allSettled(preloads));
  }).then(function () {
    var els = Array.from(document.querySelectorAll('[data-uri*="_components/"]'));

    return Promise.allSettled(els.map(function (el) {
      var m = CLAY_INSTANCE_KIND.exec(el.dataset.uri);

      if (!m) return Promise.resolve();

      var name   = m[1];
      var key    = 'components/' + name + '/client.js';
      var loader = _clayClientModules[key];

      if (!loader) return Promise.resolve();

      return loader()
        .then(function (mod) { return mod.default != null ? mod.default : mod; })
        .then(function (mod) {
          if (typeof mod === 'function') {
            // Function-export component
            mod(el);
          } else if (window.DS && typeof window.DS.get === 'function') {
            // Dollar-Slice controller — instantiate via DS.get(name, element)
            try { window.DS.get(name, el); } catch (e) { /* controller may not exist */ }
          }
        })
        .catch(function () {});
    }));
  }).finally(function () {
    performance.mark('clay-components-end');
    performance.measure('clay-components', 'clay-components-start', 'clay-components-end');
    var dur = (performance.getEntriesByName('clay-components').pop() || {}).duration;

    console.debug('Clay components took ' + dur + 'ms');
  });
}

mountComponentModules().catch(console.error);
`;

  await fs.ensureDir(CLAY_DIR);
  await fs.writeFile(VIEW_INIT_ENTRY_FILE, content, 'utf8');

  return VIEW_INIT_ENTRY_FILE;
}

/**
 * Collect all default entry points from the standard Clay directory layout.
 * Includes both generated aggregators if they exist on disk.
 *
 * @returns {string[]}
 */
function getDefaultEntryPoints() {
  const entries = ENTRY_GLOBS.flatMap(g => globSync(g));

  if (fs.existsSync(KILN_EDIT_ENTRY_FILE)) {
    entries.push(KILN_EDIT_ENTRY_FILE);
  }

  if (fs.existsSync(VIEW_INIT_ENTRY_FILE)) {
    entries.push(VIEW_INIT_ENTRY_FILE);
  }

  return entries;
}

/**
 * Build the esbuild configuration object.
 *
 * Notable choices vs. the Browserify pipeline:
 *
 *  - `format: 'esm'` + `splitting: true`  — output native ESM modules with
 *    automatic shared-chunk extraction. This replaces the hand-rolled
 *    alphabetical `_deps-a-d.js` / `_models-a-d.js` chunks.
 *
 *  - `outbase: CWD`  — preserves the directory structure so
 *    `components/foo/client.js` → `public/js/components/foo/client-HASH.js`,
 *    which is a stable key for the manifest.
 *
 *  - `entryNames: '[dir]/[name]-[hash]'`  — content-hashed filenames for
 *    long-lived browser caching. The manifest maps the unhashed key to the
 *    hashed filename so consumers don't need to guess.
 *
 *  - `chunkNames: 'chunks/[name]-[hash]'`  — shared chunks go into a
 *    dedicated subdirectory so they are easy to distinguish from entry files.
 *
 *  - No custom prelude/postlude — browsers load the entry module directly via
 *    `<script type="module">`. `window.require()` is not emitted.
 *
 * @param {object}   [options]
 * @param {boolean}  [options.minify=false]
 * @param {string[]} [options.extraEntries=[]]
 * @returns {object}
 */
function getEsbuildConfig(options = {}) {
  const { minify = false, extraEntries = [] } = options;

  // Filter out extra entry files that don't exist on disk.
  // This lets claycli.config.js esbuildConfig reference legacy files (e.g. the
  // webpack-era components/init.js) without crashing the build when those files
  // have been removed from the consuming repo.
  const existingExtras = extraEntries.filter(f => fs.existsSync(f));

  const entryPoints = [
    ...getDefaultEntryPoints(),
    ...existingExtras,
  ];

  const config = {
    entryPoints,
    bundle: true,
    splitting: true,
    format: 'esm',

    outdir: DEST,
    outbase: CWD,
    entryNames: '[dir]/[name]-[hash]',
    chunkNames: 'chunks/[name]-[hash]',
    assetNames: 'assets/[name]-[hash]',

    minify,
    sourcemap: true,
    metafile: true,

    plugins: [
      // Order matters: browserCompatPlugin must come before serviceRewritePlugin
      // so that Node built-ins and Clay server packages are stubbed out before
      // the service-rewrite plugin attempts to resolve their client counterparts.
      browserCompatPlugin(),
      serviceRewritePlugin(),
      vue2Plugin(),
    ],

    define: {
      // ── Node / browser environment shims ───────────────────────────────────
      // Replace Node.js globals that have no browser equivalent so that
      // server-side code that leaks into browser bundles doesn't throw at
      // module initialisation time.
      global: 'globalThis',
      __filename: '""',
      __dirname: '"/"',

      // process.* — esbuild uses the most-specific match first, so
      // process.env.NODE_ENV takes precedence over process.env.
      'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'development'),
      'process.env': JSON.stringify({ NODE_ENV: process.env.NODE_ENV || 'development' }),
      'process.browser': 'true',
      'process.version': '""',
      'process.versions': '{}',

      // ── Legacy implicit globals ─────────────────────────────────────────────
      // Many legacy components reference DS, Eventify, and Fingerprint2 as
      // free variables without importing them (Browserify/webpack ProvidePlugin
      // behaviour).  aaa-module-mounting.js registers these on window before
      // any component module code runs, so mapping free references to their
      // window-registered equivalents is safe and removes the need for the
      // webpack-era inject file in the consuming repo.
      DS: 'window.DS',
      Eventify: 'window.Eventify',
      Fingerprint2: 'window.Fingerprint2',
    },

    // Prefer the browser/CommonJS build over the ES module build — matches
    // the existing Browserify and Webpack behaviour and avoids pulling in
    // dual-package hazards.
    mainFields: ['browser', 'main', 'module'],

    // Target browsers that support native ESM. Adjust in claycli.config.js if
    // the project needs to support older browsers via a polyfill loader.
    target: ['chrome80', 'firefox78', 'safari14', 'edge80'],

    // Stub out Node.js built-ins (fs, crypto, etc.) automatically so that
    // server-only code that sneaks into component bundles fails gracefully
    // rather than crashing the build with unresolvable-module errors.
    platform: 'browser',

    logLevel: 'silent', // We print our own messages via the CLI handler.
  };

  // Allow consuming repos to extend the config via esbuildConfig in claycli.config.js.
  // The customizer receives the plain config object and must return it (optionally modified).
  const customizer = getConfigValue('esbuildConfig');

  if (typeof customizer === 'function') {
    const customized = customizer(config);

    if (customized && typeof customized === 'object') {
      return customized;
    }
  }

  return config;
}

/**
 * Run the esbuild JS bundle step only (no asset steps).
 * Generates the kiln edit aggregator entry first.
 *
 * @param {object}   [options]
 * @param {boolean}  [options.minify=false]
 * @param {string[]} [options.extraEntries=[]]
 * @returns {Promise}
 */
async function buildJS(options = {}) {
  await generateKilnEditEntry();
  await generateViewInitEntry();

  const config = getEsbuildConfig(options);

  if (config.entryPoints.length === 0) {
    throw new Error(
      'clay build: no entry points found.\n' +
      'Make sure your project has components/*/client.js, ' +
      'components/*/model.js, or layouts/*/client.js files.'
    );
  }

  await fs.ensureDir(DEST);

  const result = await esbuild.build(config);

  await writeManifest(result.metafile, DEST);

  return result;
}

/**
 * Run all build steps (JS, styles, fonts, templates, vendor, media) in parallel.
 *
 * The total wall-clock time is max(esbuild, PostCSS) rather than their sum.
 * The vue2 plugin writes _kiln-plugins.css via its onEnd hook as part of the
 * esbuild step.
 *
 * @param {object}   [options]
 * @param {boolean}  [options.minify=false]
 * @param {string[]} [options.extraEntries=[]]
 * @returns {Promise}
 */
async function buildAll(options = {}) {
  // copyMedia() must complete before buildTemplates() so that any
  // {{{ read 'public/media/...' }}} helpers in templates can find their files.
  await copyMedia().catch(e => console.error('[media] copy failed:', e.message));

  const [jsResult] = await Promise.all([
    buildJS(options),
    buildStyles(options).catch(e => console.error('[styles] build failed:', e.message)),
    buildFonts().catch(e => console.error('[fonts] build failed:', e.message)),
    buildTemplates(options).catch(e => console.error('[templates] build failed:', e.message)),
    copyVendor().catch(e => console.error('[vendor] copy failed:', e.message)),
  ]);

  return jsResult;
}

/**
 * Run a one-shot full build (JS + all asset steps) and write `_manifest.json`.
 *
 * @param {object}   [options]
 * @param {boolean}  [options.minify=false]
 * @param {string[]} [options.extraEntries=[]]
 * @returns {Promise}
 */
async function build(options = {}) {
  return buildAll(options);
}

/**
 * Start file watchers that rebuild only what changes.
 *
 * All watchers use chokidar with polling (required for Docker + macOS host
 * volumes). The esbuild context is initialised lazily in the background so it
 * doesn't block startup. `watch()` resolves only after every chokidar watcher
 * has emitted its 'ready' event — i.e. the "Watching for changes" log that
 * the CLI prints after awaiting this function is accurate.
 *
 * @param {object}   [options]
 * @param {boolean}  [options.minify=false]
 * @param {string[]} [options.extraEntries=[]]
 * @param {function} [options.onRebuild] - Called after each JS rebuild with (errors, warnings).
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
    changed: s => `\x1b[33m${s}\x1b[0m`,  // yellow  — "something changed"
    rebuilt: s => `\x1b[32m${s}\x1b[0m`,  // green   — "done"
    file:    s => `\x1b[36m${s}\x1b[0m`,  // cyan    — file paths
    error:   s => `\x1b[31m${s}\x1b[0m`,  // red     — errors
  };

  // --- Lazy esbuild context -------------------------------------------------
  // Kicked off immediately so it is ready by the time the first JS change
  // arrives. Does NOT block the watcher setup below.

  const esbuildReady = (async () => {
    if (!fs.existsSync(KILN_EDIT_ENTRY_FILE)) {
      await generateKilnEditEntry();
    }

    await generateViewInitEntry();

    const config = getEsbuildConfig(options);

    if (config.entryPoints.length === 0) {
      throw new Error(
        'clay build: no entry points found.\n' +
        'Make sure your project has components/*/client.js, ' +
        'components/*/model.js, or layouts/*/client.js files.'
      );
    }

    await fs.ensureDir(DEST);

    const manifestPlugin = {
      name: 'clay-manifest-writer',
      setup(b) {
        b.onEnd(async result => {
          if (result.errors.length === 0) {
            await writeManifest(result.metafile, DEST);
          }

          if (onRebuild) {
            onRebuild(result.errors, result.warnings);
          }
        });
      },
    };

    return esbuild.context({
      ...config,
      plugins: [...config.plugins, manifestPlugin],
    });
  })().catch(e => {
    console.error('[js] Watch setup failed:', e.message);
  });

  // --- JS watcher -----------------------------------------------------------

  const JS_GLOBS = [
    path.join(CWD, 'components', '**', '*.js'),
    path.join(CWD, 'layouts', '**', '*.js'),
    path.join(CWD, 'global', '**', '*.js'),
    path.join(CWD, 'services', '**', '*.js'),
    KILN_EDIT_ENTRY_FILE,
    VIEW_INIT_ENTRY_FILE,
  ];

  const rebuildJs = debounce(async (changedFile, eventType) => {
    if (changedFile) console.log(clr.changed(`[js] Changed: `) + clr.file(rel(changedFile)));

    // When a client.js is added or removed, regenerate _view-init.js so the
    // explicit component module map stays up to date.
    if (eventType !== 'change' && changedFile && changedFile.endsWith('client.js')) {
      await generateViewInitEntry();
    }

    try {
      const ctx = await esbuildReady;

      if (ctx) await ctx.rebuild();
    } catch (e) {
      console.error(clr.error(`[js] rebuild failed: ${e.message}`));
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
    // Derive the component prefix from the changed file.
    // e.g. "text-list_amp.css" → stem "text-list_amp" → prefix "text-list"
    //      "text-list.css"     → stem "text-list"     → prefix "text-list"
    // Then rebuild every file whose stem is exactly the prefix OR starts with
    // "<prefix>_" (i.e. any variation), across all styleguides.
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
      console.log(clr.changed(`[styles] Changed: `) + clr.file(rel(changedFile)));
    }

    return buildStyles({ ...options, changedFiles })
      .then(paths => {
        if (paths.length > 0) {
          console.log(clr.rebuilt(`[styles] Rebuilt: `) + clr.file(paths.map(p => rel(p)).join(', ')));
        }
      })
      .catch(e => console.error(clr.error(`[styles] rebuild failed: ${e.message}`)));
  }, 200);

  const cssWatcher = chokidar.watch(STYLE_GLOBS, chokidarOpts);

  cssWatcher.on('change', rebuildStyles).on('add', rebuildStyles).on('unlink', rebuildStyles);

  // --- Font watcher ---------------------------------------------------------

  const rebuildFonts = debounce((changedFile) => {
    if (changedFile) console.log(clr.changed(`[fonts] Changed: `) + clr.file(rel(changedFile)));

    return buildFonts()
      .then(() => console.log(clr.rebuilt('[fonts] Rebuilt')))
      .catch(e => console.error(clr.error(`[fonts] rebuild failed: ${e.message}`)));
  }, 200);

  const fontWatcher = chokidar.watch(FONTS_SRC_GLOB, chokidarOpts);

  fontWatcher.on('change', rebuildFonts).on('add', rebuildFonts).on('unlink', rebuildFonts);

  // --- Template watcher -----------------------------------------------------

  const rebuildTemplates = debounce((changedFile) => {
    if (changedFile) console.log(clr.changed(`[templates] Changed: `) + clr.file(rel(changedFile)));

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

  // --- Wait until every watcher has finished its initial scan ---------------
  // The 'ready' event fires once chokidar has traversed all watched paths and
  // is genuinely listening for changes. We await all of them so that the
  // "Watching for changes" log the CLI prints after this function resolves is
  // accurate — not premature.

  const allWatchers = [jsWatcher, cssWatcher, fontWatcher, templateWatcher];

  await Promise.all(allWatchers.map(w => new Promise(resolve => w.once('ready', resolve))));

  // --- Context returned to CLI ----------------------------------------------

  return {
    dispose: async () => {
      await Promise.all(allWatchers.map(w => w.close()));

      const ctx = await esbuildReady.catch(() => null);

      if (ctx) await ctx.dispose();
    },
  };
}

/**
 * The manifest key for the generated kiln edit-mode aggregator bundle.
 * Used by get-script-dependencies.js to look up the hashed URL.
 */
const KILN_EDIT_ENTRY_KEY = path.relative(CWD, KILN_EDIT_ENTRY_FILE).replace(/\\/g, '/').replace(/\.js$/, '');

module.exports = { build, buildAll, buildJS, watch, getEsbuildConfig, generateKilnEditEntry, KILN_EDIT_ENTRY_KEY, generateViewInitEntry, VIEW_INIT_ENTRY_KEY };

'use strict';

// claycli is a CommonJS package, so we call Vite via require().
// Vite 5 ships a full CJS build alongside its ESM build; this warning only
// fires when Vite itself is imported as CJS, not when it *builds* CJS code.
process.env.VITE_CJS_IGNORE_WARNING = 'true';

const vite = require('vite');
const fs = require('fs-extra');
const path = require('path');

const { getConfigValue } = require('../../config-file-helpers');
const viteBrowserCompatPlugin = require('./plugins/browser-compat');
const viteServiceRewritePlugin = require('./plugins/service-rewrite');
const viteMissingModulePlugin = require('./plugins/missing-module');
const viteVue2Plugin = require('./plugins/vue2');
const viteManualChunksPlugin = require('./plugins/manual-chunks');
const { createClientEnvCollector } = require('./plugins/client-env');

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
 * Read and apply the bundlerConfig() customizer from claycli.config.js.
 *
 * bundlerConfig() is the single hook for customizing the Vite build pipeline.
 * Plugins use the standard Rollup plugin API (resolveId, load, transform) since
 * Vite's production build uses Rollup internally.
 *
 * Config shape (all keys optional):
 *
 *   {
 *     minify:             false,
 *     extraEntries:       [],
 *     manualChunksMinSize: undefined, // bytes — controls chunk merging threshold.
 *                                  // Not set by default: omitting it means no
 *                                  // inlining/merging (equivalent to 0).
 *                                  // Suggested values for CJS/mixed codebases:
 *                                  //   4096  (4 KB) — conservative, fewer merges
 *                                  //   8192  (8 KB) — balanced, recommended starting point
 *                                  // In CJS mode (clientFilesESM:false) this feeds
 *                                  // viteManualChunksPlugin which inlines small private
 *                                  // deps into their owner chunk.
 *                                  // In ESM mode (clientFilesESM:true) this maps to
 *                                  // Rollup's native experimentalMinChunkSize which
 *                                  // merges small chunks across the whole graph.
 *     clientFilesESM:     false,  // set true once all client.js files and their deps
 *                                  // are native ESM.  Switches the view-mode pass from
 *                                  // viteManualChunksPlugin to Rollup's native
 *                                  // experimentalMinChunkSize (driven by manualChunksMinSize).
 *                                  // Does NOT affect the kiln pass — use kilnSplit for that.
 *     kilnSplit:          false,  // set true once all model.js/kiln.js are ESM —
 *                                  // collapses the two-pass build into one graph.
 *     define:             {},     // identifier replacements merged on top of built-in
 *                                  // defines (process.env.NODE_ENV, __dirname, etc.)
 *     alias:              {},     // module path aliases applied at resolution time.
 *                                  // Equivalent to Vite's resolve.alias.  Keys are
 *                                  // bare specifiers or path prefixes; values are
 *                                  // absolute paths or replacement specifiers:
 *                                  //   '@sentry/node': '@sentry/browser'
 *                                  //   '@utils': path.resolve(__dirname, 'src/utils')
 *                                  // For complex patterns (regex, onResolve hooks),
 *                                  // add a Rollup plugin via `plugins` instead.
 *     sourcemap:          true,   // emit .js.map files alongside every output chunk.
 *                                  // Keeps DevTools stack traces symbolicated and lets
 *                                  // error monitoring (Sentry) map runtime errors to
 *                                  // source lines.  Disable to save build time in CI
 *                                  // environments where sourcemaps are not consumed:
 *                                  //   config.sourcemap = false;
 *     plugins:            [],     // extra Rollup/Vite plugins appended after built-ins
 *     commonjsExclude:    [],     // patterns passed to @rollup/plugin-commonjs `exclude`
 *                                  // for CJS packages whose internal eval() scope must
 *                                  // not be rewritten (e.g. webpack dev bundles like
 *                                  // pyxis-frontend that use eval() for modules)
 *     browserStubs:       {},     // site-specific Node.js module stubs for the browser
 *                                  // bundle.  Keys are module names; values are either
 *                                  // null (empty-object stub) or a custom ESM string:
 *                                  //   'ioredis': null
 *                                  //   'mongodb': 'export default { connect: function() {} };'
 *                                  // Site stubs override built-ins when names collide.
 *   }
 *
 * @param {object} [cliOptions]
 * @returns {object}
 */
function getViteConfig(cliOptions = {}) {
  const config = {
    minify:              cliOptions.minify || false,
    extraEntries:        cliOptions.extraEntries || [],
    manualChunksMinSize: undefined,
    clientFilesESM:      false,
    kilnSplit:           false,
    define:              {},
    alias:               {},
    sourcemap:           true,
    plugins:             [],
    commonjsExclude:     [],
    browserStubs:        {},
  };

  // Read bundlerConfig() from claycli.config.js — the single hook for
  // customizing the Vite build pipeline.
  const customizer = getConfigValue('bundlerConfig');

  if (typeof customizer === 'function') {
    const customized = customizer(config);

    if (customized && typeof customized === 'object') return customized;
  }

  return config;
}

exports.getViteConfig = getViteConfig;

/**
 * Build the define map injected into every module at compile time.
 *
 * Vite uses esbuild under the hood for define substitution, so these are
 * identifier-scoped replacements (not substring replacements like sed).
 * Only meaningful identifiers are replaced — string literals are never touched.
 *
 * Node globals (process, __filename, etc.) appear in isomorphic Clay services
 * that run on both the server and in the browser.  Stubbing them here lets the
 * browser bundle compile without a polyfill, while the real Node values are
 * used at runtime on the server.
 *
 * @param {object} userDefines - extra defines from bundlerConfig()
 * @returns {object}
 */
function buildDefines(userDefines = {}) {
  const NODE_ENV = process.env.NODE_ENV || 'development';

  return Object.assign(
    {
      // Guards like `if (process.env.NODE_ENV === 'production')` tree-shake
      // correctly in the browser bundle.
      'process.env.NODE_ENV': JSON.stringify(NODE_ENV),

      // process.browser is a convention used by some isomorphic libraries to
      // branch between Node and browser paths.
      'process.browser': JSON.stringify(true),

      // process.version and process.versions are read by clay-log to detect
      // the runtime environment. Stub to empty values so the browser branch
      // is taken rather than the Node branch.
      'process.version':  JSON.stringify(''),
      'process.versions': JSON.stringify({}),

      // __filename and __dirname are used in some server-side Clay utilities.
      // In the browser bundle they are never accessed at runtime, but they
      // must resolve to something so the module compiles.
      __filename: JSON.stringify(''),
      __dirname:  JSON.stringify('/'),

      // global → globalThis. Some older CJS packages reference global instead
      // of window. globalThis is universally available in ES2017+ environments.
      global: 'globalThis',
    },
    userDefines
  );
}

/**
 * Assemble the Vite plugin array for a build pass.
 *
 * Plugin order matters because each runs in sequence on every resolved module:
 *
 *   1. browser-compat  — intercepts Node built-in imports (fs, path, events …)
 *                        and replaces them with browser-safe stubs BEFORE any
 *                        other plugin or Vite's resolver sees them.  Runs first
 *                        because some node_modules transitively import built-ins
 *                        and must be redirected at resolution time.
 *
 *   2. service-rewrite — redirects any import of services/server/* to the
 *                        matching services/client/* file.  Clay components use
 *                        isomorphic service paths; the browser bundle always gets
 *                        the client implementation.
 *
 *   3. missing-module  — stubs unresolvable relative imports with an empty ESM
 *                        module instead of erroring.  Browserify silently skipped
 *                        missing requires; this plugin preserves that lenient
 *                        behaviour while the codebase is still being cleaned up.
 *
 *   4. vue2            — compiles .vue Single File Components using Vue 2's
 *                        template compiler.  Must run before Vite's JS pipeline
 *                        so that .vue files are converted to plain JS before
 *                        @rollup/plugin-commonjs processes any require() calls
 *                        in the <script> block.
 *
 *   5. user plugins    — site-specific overrides from bundlerConfig().plugins,
 *                        appended last so they can override any of the above.
 *
 * Note: the client-env collector plugin (clay-client-env) is NOT assembled
 * here.  It is created per-build in buildJS/watch via createClientEnvCollector
 * and injected as an internalPlugins argument to runViewBuild/runKilnBuild.
 * This keeps the collector separate from the user-facing plugin list.
 *
 * CJS→ESM conversion is handled by Vite's single built-in @rollup/plugin-commonjs
 * instance, configured in baseViteConfig() via build.commonjsOptions.  A second
 * instance must NOT be added here — two commonjs instances each maintain their
 * own internal virtual-module state (?commonjs-proxy, ?commonjs-wrapped …) and
 * will leave require() calls untransformed in the final bundle.
 *
 * @param {object[]} [extraPlugins]
 * @param {object}   [browserStubs]  site stubs from bundlerConfig().browserStubs
 * @returns {object[]}
 */
function buildPlugins(extraPlugins = [], browserStubs = {}) {
  return [
    viteBrowserCompatPlugin(browserStubs),
    viteServiceRewritePlugin(),
    viteMissingModulePlugin(),
    viteVue2Plugin(),
    ...extraPlugins,
  ];
}

// ── Manifest ────────────────────────────────────────────────────────────────

/**
 * Build _manifest.json from one or two Vite RollupOutput results.
 *
 * viewOutput  — the splitting pass (bootstrap + component chunks)
 * kilnOutput  — the single-file kiln edit pass (null when kilnSplit is true)
 *
 * The manifest shape { key: { file, imports } } is the contract between the
 * build pipeline and resolve-media.js.  Every pipeline (Browserify included)
 * must produce a compatible manifest so the runtime asset injector works
 * without knowing which bundler was used.
 *
 * @param {import('rollup').RollupOutput|null} viewOutput
 * @param {import('rollup').RollupOutput|null} kilnOutput
 * @param {string} publicBase
 * @returns {object}
 */
function buildManifest(viewOutput, kilnOutput = null, publicBase = '/js') {
  const manifest = {};

  for (const output of [viewOutput, kilnOutput]) {
    for (const chunk of output ? output.output : []) {
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
 * Return the base Vite config shared by both build passes (view and kiln).
 *
 * ── Why Vite for production builds ──────────────────────────────────────────
 *
 * The legacy Browserify pipeline bundled all component JavaScript into a
 * handful of monolithic files.  Every page load re-downloaded the full bundle
 * even if the user had visited before, and every deploy invalidated the cache
 * for all pages simultaneously.
 *
 * Vite's production build uses Rollup under the hood to emit native ES modules
 * with content-hashed filenames.  Components are loaded on demand via
 * dynamic import(), so the browser only fetches the code each page actually
 * needs.  Unchanged modules keep their hash across deploys and are served
 * straight from the browser cache on repeat visits.
 *
 * ── Why native ESM output ────────────────────────────────────────────────────
 *
 * Browserify emitted a single synchronous IIFE bundle — the browser had to
 * parse and evaluate all component code before any component could mount,
 * which directly raised Time to Interactive and Total Blocking Time.
 *
 * Native ESM allows the browser to parse modules in parallel and defer
 * evaluation of off-screen components until they are actually needed.
 *
 * ── Migration doors ─────────────────────────────────────────────────────────
 *
 * CSS (Lightning CSS):
 *   The styles step currently uses PostCSS via buildStyles().
 *   When ready to migrate, add:
 *     css: { transformer: 'lightningcss', lightningcssOptions: { ... } }
 *   to the returned config object and remove the PostCSS step from buildAll().
 *   The `lightningcss` package must be added as a dependency.
 *   Lightning CSS is faster and handles modern CSS features (nesting, color-mix,
 *   etc.) natively without PostCSS plugins.
 *
 * Vue 3:
 *   The vue2 plugin handles .vue files today.  To start writing new components
 *   in Vue 3, add @vitejs/plugin-vue to bundlerConfig().plugins in claycli.config.js:
 *     import vuePlugin from '@vitejs/plugin-vue';
 *     config.plugins.push(vuePlugin());
 *   Both plugins can coexist — vue2 handles legacy SFCs, @vitejs/plugin-vue
 *   handles new ones (differentiate by directory or a file-naming convention).
 *   Once all .vue files are migrated to Vue 3, remove viteVue2Plugin().
 *
 * ESM migration:
 *   As source files are converted from require()/module.exports to import/export,
 *   the CJS shims shrink automatically:
 *     - @rollup/plugin-commonjs (commonjsOptions) becomes a no-op per migrated file
 *     - strictRequires entries drop as circular require() cycles are eliminated
 *     - transformMixedEsModules can be removed once all .vue scripts use ESM
 *     - kilnSplit can be set true once all model.js/kiln.js files are ESM,
 *       collapsing the two-pass build into a single faster graph
 *   New components should be written as ESM from day one.
 *
 * @param {object} viteCfg   — result of getViteConfig()
 * @returns {object}
 */
function baseViteConfig(viteCfg) {
  // The base path must match the URL prefix under which public/js/ is served.
  // Vite embeds this into dynamic import() calls inside the bootstrap so that
  // chunk URLs resolve to /js/chunks/… rather than just /chunks/….
  const publicBase = (viteCfg.publicBase || '/js').replace(/\/$/, '');

  return {
    root:       CWD,
    base:       publicBase + '/',
    configFile: false, // always use this programmatic config; never read vite.config.js
    logLevel:   'warn',
    plugins:    buildPlugins(viteCfg.plugins, viteCfg.browserStubs),
    define:     buildDefines(viteCfg.define),
    resolve: {
      browserField: true,

      // Field resolution order: prefer the browser-specific build, then the
      // CommonJS main entry, then ESM via the module field.
      //
      // `module` is intentionally last: some packages ship both CJS (main) and
      // ESM (module) builds; using the CJS build is safer when @rollup/plugin-commonjs
      // is active because it applies the same transformation consistently.
      //
      // ESM migration lever: once the codebase no longer needs @rollup/plugin-commonjs,
      // flip this to ['browser', 'module', 'main'] so Rollup can tree-shake ESM
      // packages directly.
      mainFields: ['browser', 'main', 'module'],

      // Site-defined module aliases from bundlerConfig().alias.
      // This is the first-class alternative to writing a full Rollup plugin just
      // to redirect a specifier.  Common use-cases:
      //   - swap a server-only package for its browser equivalent at build time
      //     (e.g. '@sentry/node' → '@sentry/browser')
      //   - point a bare specifier at an absolute path
      //     (e.g. '@utils' → path.resolve(__dirname, 'src/utils'))
      // For complex patterns (regex, conditional logic), use bundlerConfig().plugins
      // with a resolveId hook instead.
      alias: viteCfg.alias || {},
    },

    // optimizeDeps is Vite's pre-bundler that converts CJS node_modules to ESM using
    // esbuild before Rollup processes them.  We use Vite exclusively for production builds
    // (vite build) — the Vite dev server and HMR are not used.  Clay runs a server-rendered
    // architecture (Amphora) where watch mode uses Rollup's own incremental rebuild, not a
    // Vite dev server in the request path.
    //
    // optimizeDeps does NOT run during `vite build` — production builds go straight through
    // Rollup, which handles CJS via @rollup/plugin-commonjs (configured below).
    // Setting noDiscovery:true prevents accidental dep scanning that can add latency
    // to build startup in some Vite versions.
    optimizeDeps: { noDiscovery: true, include: [] },

    build: {
      // Target ES2017 (async/await, Object.assign, etc.) — supported by all
      // browsers we care about.  This lets Rollup emit clean async code without
      // transpiling it to generator functions.
      //
      // ESM migration note: bump to 'es2020' when ready to use optional chaining
      // and nullish coalescing natively in the output (Vue 3 recommends es2020+).
      target: 'es2017',

      outDir:      DEST,
      emptyOutDir: false, // we write into public/js/ which already exists
      // Configurable via bundlerConfig().sourcemap.  Defaults to true so that
      // DevTools stack traces and Sentry source mapping work out of the box.
      // Set to false in CI pipelines that do not consume source maps to shave
      // a few seconds off the build without changing runtime behaviour.
      sourcemap:   viteCfg.sourcemap !== false,
      minify:      viteCfg.minify ? 'esbuild' : false,

      // Skips the extra gzip pass Vite performs after bundling just to print the
      // compressed sizes in the terminal.  That pass is never free — on a large
      // codebase it adds 1–3 s.  The uncompressed sizes are enough to catch
      // regressions during development; use a dedicated bundle-analysis script
      // (scripts/perf/01-bundle-analysis.js) for accurate gzip numbers.
      reportCompressedSize: false,

      // We handle CSS extraction ourselves: component .css files go through the
      // PostCSS step in buildStyles(), and .vue scoped styles are injected at
      // runtime by viteVue2Plugin().  Letting Vite split CSS would generate
      // separate .css chunks that nothing requests.
      cssCodeSplit: false,

      // public/js/ lives inside public/ which is also the publicDir.  Vite warns
      // when outDir is inside publicDir because it tries to copy publicDir into
      // outDir at the end of the build.  We disable that copy entirely — static
      // assets are managed by copyMedia/copyVendor/buildFonts.
      copyPublicDir: false,

      // Suppress the default 500 KB chunk size warning.  The kiln edit bundle
      // is intentionally large (all component models + kiln plugins in one file)
      // because it only loads in edit mode, not on public pages.
      chunkSizeWarningLimit: 10000,

      // Don't inject a modulepreload polyfill.  We target ES2017+ browsers that
      // all support <link rel="modulepreload"> natively.  The polyfill is ~2 KB
      // of dead code for our audience.
      modulePreload: { polyfill: false },

      // Configure Vite's single built-in @rollup/plugin-commonjs instance.
      //
      // This is the bridge between the CJS-heavy existing codebase and Rollup's
      // native ESM module graph.  Every require() call in source files is
      // converted to an ESM import so Rollup can tree-shake and bundle correctly.
      // Browserify handled CJS implicitly; here it is explicit and configurable.
      //
      // IMPORTANT: do not add a second @rollup/plugin-commonjs instance via plugins[].
      // Each instance tracks its own set of ?commonjs-* virtual modules, so two
      // instances conflict and leave require() calls in the output.
      commonjsOptions: {
        // Apply to all JS, CJS, and .vue files.  Two checks must pass inside
        // @rollup/plugin-commonjs: the `include` regex (createFilter check) and
        // the `extensions` list (path.extname check).
        include:    /\.(js|cjs|vue)$/,
        extensions: ['.js', '.cjs', '.vue'],

        // Required for .vue files: viteVue2Plugin always appends `export default __sfc__`
        // regardless of whether the <script> block used require() or ESM, so every
        // compiled .vue file is "mixed" (CJS body + ESM export default).  Without
        // this flag, @rollup/plugin-commonjs would skip the require() conversion and
        // leave bare require() calls in the browser bundle.
        //
        // For plain .js files: mixing require() and import/export in the same file
        // is prohibited — files must be either pure CJS or pure ESM.
        transformMixedEsModules: true,

        // requireReturnsDefault: 'preferred' — when CJS code does `const x = require('y')`,
        // return y.default if it exists, otherwise return the whole module object.
        // This matches the natural expectation from CJS code that doesn't know about
        // ESM default exports, and avoids `.default.method()` call-site surprises.
        requireReturnsDefault: 'preferred',

        // strictRequires: 'auto' — for modules involved in circular require() chains
        // (e.g. services/client/auth.js ↔ services/client/gtm.js), wrap the require()
        // calls in lazy getters so both modules can fully initialize before either
        // reads the other's exports.  'auto' applies this only to modules that
        // @rollup/plugin-commonjs detects as part of a cycle, leaving all other
        // require() calls as direct synchronous calls (no overhead).
        strictRequires: 'auto',

        // Sites can exclude specific packages via commonjsExclude in bundlerConfig().
        // Use this for packages that use eval() internally in ways that break when
        // @rollup/plugin-commonjs rewrites their module scope (e.g. webpack dev-mode
        // bundles where eval() strings reference `exports` as a function parameter
        // that gets renamed by the CJS transformation).
        exclude: viteCfg.commonjsExclude || [],
      },
    },
  };
}

// ── Build passes ────────────────────────────────────────────────────────────

/**
 * Return the output.manualChunks / output.experimentalMinChunkSize entry for
 * rollupOptions.output based on whether the codebase is fully ESM.
 *
 * CJS mode (clientFilesESM:false): @rollup/plugin-commonjs injects \0-prefixed
 * virtual proxy modules into the graph which inflate apparent module sizes and
 * add phantom importer edges.  Rollup's native experimentalMinChunkSize would
 * produce inaccurate merges in this environment.  viteManualChunksPlugin guards
 * against virtual modules explicitly and uses info.code.length as an honest size
 * proxy for pre-minification CJS source.
 *
 * ESM mode (clientFilesESM:true): the graph is clean — no proxy modules, no CJS
 * wrapper boilerplate.  Rollup's native experimentalMinChunkSize is accurate and
 * optimal; viteManualChunksPlugin is no longer needed.  manualChunksMinSize maps
 * directly to the native threshold (0 = no merging if the site leaves it unset).
 *
 * @param {object} viteCfg
 * @returns {object}
 */
function buildChunkingOutput(viteCfg) {
  const minSize = viteCfg.manualChunksMinSize ?? 0;

  if (viteCfg.clientFilesESM) {
    return { experimentalMinChunkSize: minSize };
  }

  return { manualChunks: viteManualChunksPlugin(minSize, CWD) };
}


/**
 * Pass 1 — view mode (splitting pass).
 *
 * Builds the bootstrap entry point plus any extra entries.  Rollup splits the
 * module graph into shared chunks — each shared dependency gets its own
 * content-hashed file that the browser can cache independently.
 *
 * Compared to Browserify's single bundle, the browser only downloads the code
 * for components present on the current page, and unchanged modules are served
 * from cache on subsequent page loads.
 *
 * When kilnSplit is false (the default while model.js files are still CJS),
 * the kiln-edit entry is excluded from this graph to prevent CJS model.js
 * dependencies from polluting the view-mode chunk set.  Set kilnSplit:true
 * in bundlerConfig() once all model.js/kiln.js files use ESM.
 *
 * @param {object} viteCfg
 * @param {object} internalPlugins
 * @returns {Promise<import('rollup').RollupOutput>}
 */
async function runViewBuild(viteCfg, internalPlugins) {
  const entryMap = {};

  entryMap[VITE_BOOTSTRAP_KEY] = VITE_BOOTSTRAP_FILE;

  if (viteCfg.kilnSplit) {
    entryMap[KILN_EDIT_ENTRY_KEY] = KILN_EDIT_ENTRY_FILE;
  }

  for (const extraPath of viteCfg.extraEntries || []) {
    if (fs.existsSync(extraPath)) {
      const key = path.relative(CWD, extraPath).replace(/\\/g, '/').replace(/\.js$/, '');

      entryMap[key] = extraPath;
    }
  }

  const cfg = baseViteConfig(viteCfg);

  if (internalPlugins && internalPlugins.length) {
    cfg.plugins = cfg.plugins.concat(internalPlugins);
  }

  cfg.build.rollupOptions = {
    input:  entryMap,
    output: {
      format:         'esm',
      entryFileNames: '[name]-[hash].js',
      chunkFileNames: 'chunks/[name]-[hash].js',
      // See buildChunkingOutput() for CJS vs ESM branching rationale.
      ...buildChunkingOutput(viteCfg),
    },
    onwarn: suppressWarning,
  };

  const result = await vite.build(cfg);

  return Array.isArray(result) ? result[0] : result;
}

/**
 * Pass 2 — kiln edit mode (no-split pass).
 *
 * The kiln-edit-init entry imports every component's model.js and kiln.js.
 * These files are CJS today and cannot be tree-shaken, so their transitive
 * dependencies (utility libraries, lodash, etc.) would bleed into the
 * view-mode chunk graph if this entry were included in the splitting pass.
 * Running it as a separate isolated pass with inlineDynamicImports:true
 * produces one self-contained file that is only loaded in edit mode.
 *
 * Edit mode (kiln) is a separate concern from public page rendering — this
 * file is never delivered to readers, only to editors inside the CMS.
 *
 * ESM migration path: once all model.js/kiln.js files are ESM, set
 * kilnSplit:true in bundlerConfig().  This adds the kiln entry to the same
 * splitting graph as the bootstrap, Rollup tree-shakes across both, and the
 * separate kiln pass is no longer needed.
 *
 * @param {object} viteCfg
 * @returns {Promise<import('rollup').RollupOutput>}
 */
async function runKilnBuild(viteCfg, internalPlugins) {
  const cfg = baseViteConfig(viteCfg);

  if (internalPlugins && internalPlugins.length) {
    cfg.plugins = cfg.plugins.concat(internalPlugins);
  }

  cfg.build.rollupOptions = {
    input:  { [KILN_EDIT_ENTRY_KEY]: KILN_EDIT_ENTRY_FILE },
    output: {
      format:               'esm',
      entryFileNames:       '[name]-[hash].js',
      inlineDynamicImports: true,

      // Kiln plugin .vue files (modal.vue, settings.vue, etc.) reference
      // window.kiln.config.pyxis and window.kiln.utils.* at MODULE-EVALUATION
      // time — at the top-level of the <script> block, before any function is
      // called.  With inlineDynamicImports:true, Rollup evaluates all modules
      // in dependency order.  The kiln init function (_initKilnPlugins) runs
      // at the very end of the bundle, but module-level code in .vue files
      // runs earlier, before kiln globals are available.
      //
      // The banner pre-populates all kiln namespaces with empty objects so that
      // destructuring patterns like `const { pyxis } = window.kiln.config`
      // in .vue modules don't throw.  _initKilnPlugins() replaces these empty
      // objects with real values later in the same synchronous tick.
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
 * Generate all entry files, run both build passes, then write _manifest.json.
 *
 * Entry generation order:
 *   1. generateViteGlobalsInit() and generateViteKilnEditEntry() run in parallel
 *      (they write to independent files and have no shared dependencies).
 *   2. generateViteBootstrap() runs after globals, because it checks whether
 *      .clay/_globals-init.js exists to decide whether to import it.
 *
 * Build pass order:
 *   Both passes (view and kiln) run in parallel via Promise.all.  They write to
 *   independent file sets (the kiln entry is excluded from the view graph) so
 *   there is no ordering constraint between them.
 *
 * @param {object} [options]
 * @returns {Promise<void>}
 */
async function buildJS(options = {}) {
  // Globals and kiln entry do not depend on each other — generate concurrently.
  await Promise.all([
    generateViteGlobalsInit(),
    generateViteKilnEditEntry(),
  ]);

  // Bootstrap depends on globals existing (it checks pathExists before importing).
  await generateViteBootstrap();

  if (!fs.existsSync(VITE_BOOTSTRAP_FILE)) {
    throw new Error('clay vite: missing .clay/vite-bootstrap.js after prepare.');
  }

  await fs.ensureDir(DEST);

  const viteCfg = getViteConfig(options);
  const envCollector = createClientEnvCollector(path.join(CWD, 'client-env.json'));
  const envPlugin = envCollector.plugin();

  let viewOutput, kilnOutput;

  if (viteCfg.kilnSplit) {
    // Single pass — kiln is in the same Rollup graph as the bootstrap.
    // Only safe once all model.js/kiln.js files are native ESM.
    viewOutput = await runViewBuild(viteCfg, [envPlugin]);
    kilnOutput = null;
  } else {
    // Two passes in parallel — kiln is isolated in its own no-split graph.
    // This prevents CJS model.js dependencies from creating phantom shared chunks
    // in the view-mode graph that would increase page load request counts.
    [viewOutput, kilnOutput] = await Promise.all([
      runViewBuild(viteCfg, [envPlugin]),
      runKilnBuild(viteCfg, [envPlugin]),
    ]);
  }

  const manifest = buildManifest(viewOutput, kilnOutput);

  await writeManifest(manifest);
  await envCollector.write();
}

exports.buildJS = buildJS;

// ── Full build (JS + assets in parallel) ────────────────────────────────────

/**
 * Run all build steps: JS + styles + fonts + templates + vendor + media.
 *
 * media runs first (sequential) so that SVG files are on disk before the
 * templates step tries to inline them via {{{ read 'public/media/…' }}}.
 * All remaining steps run in parallel after media completes.
 *
 * @param {object} [options]
 * @returns {Promise<void>}
 */
async function buildAll(options = {}) {
  const isTTY = process.stdout.isTTY;
  const SPINNER = ['⠋','⠙','⠹','⠸','⠼','⠴','⠦','⠧','⠇','⠏'];

  const clr = {
    label: s => `\x1b[36m${s}\x1b[0m`,
    done:  s => `\x1b[32m${s}\x1b[0m`,
    fail:  s => `\x1b[31m${s}\x1b[0m`,
    time:  s => `\x1b[90m${s}\x1b[0m`,
    spin:  s => `\x1b[33m${s}\x1b[0m`,
  };

  const states    = new Map();
  const totalStart = Date.now();

  let spinFrame = 0,
    timer = null,
    progressUp = false;

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
      if ([...states.values()].every(v => v.done)) {
        clearInterval(timer);
        timer = null;
      } else {
        writeSummary();
      }
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

  // Media must complete before templates — the template step reads SVG files
  // from public/media/ via {{{ read 'public/media/…' }}} Handlebars helpers.
  await step('media', () => copyMedia());

  if (isTTY) {
    timer = setInterval(() => { spinFrame++; clearSummary(); writeSummary(); }, 80);
  }

  await Promise.all([
    step('js',        () => buildJS(options)),
    step('styles',    () => buildStyles(options)),
    step('fonts',     () => buildFonts()),
    step('templates', () => buildTemplates(options)),
    step('vendor',    () => copyVendor()),
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
 * Start Rollup's incremental watcher for JS plus chokidar watchers for
 * CSS, fonts, and templates.
 *
 * JS watch strategy:
 *   Rollup's watch mode rebuilds only the modules that changed, not the whole
 *   bundle.  This is significantly faster than Browserify's full-bundle rebuild
 *   on every save because the module graph is already resolved; only the dirty
 *   sub-graph is re-processed.
 *
 *   In two-pass mode (kilnSplit:false): the kiln bundle is built once up-front,
 *   then only rebuilt when a model.js or kiln.js file changes.  Client.js
 *   changes only trigger the faster view-mode incremental rebuild.
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

  // ── JS watch via Rollup watch mode ──────────────────────────────────────────

  const viteCfg = getViteConfig(options);

  // Collector accumulates process.env references from both passes across the
  // entire watch session.  The Set is append-only: removing a reference leaves
  // a stale entry until the next full build, which is harmless (the server
  // injects undefined for unused vars).  Missing entries would silently break
  // client-side code, so we intentionally err on the side of inclusion.
  const envCollector = createClientEnvCollector(path.join(CWD, 'client-env.json'));

  // Same parallelization as buildJS: globals + kiln-edit first, then bootstrap.
  await Promise.all([
    generateViteGlobalsInit(),
    generateViteKilnEditEntry(),
  ]);
  await generateViteBootstrap();
  await fs.ensureDir(DEST);

  // In two-pass mode: build kiln once up-front, then rebuild only when
  // model.js/kiln.js files change.  Client.js changes only trigger the
  // view-mode incremental rebuild, which is faster.
  let kilnOutput = null;

  if (!viteCfg.kilnSplit) {
    kilnOutput = await runKilnBuild(viteCfg, [envCollector.plugin()]);
  }

  const watchInput = viteCfg.kilnSplit
    ? { [VITE_BOOTSTRAP_KEY]: VITE_BOOTSTRAP_FILE, [KILN_EDIT_ENTRY_KEY]: KILN_EDIT_ENTRY_FILE }
    : { [VITE_BOOTSTRAP_KEY]: VITE_BOOTSTRAP_FILE };

  const watchCfg = baseViteConfig(viteCfg);

  // Add the env collector to the watch build so Rollup picks up process.env
  // references as it incrementally rebuilds changed modules.
  watchCfg.plugins = watchCfg.plugins.concat([envCollector.plugin()]);

  watchCfg.build.outDir = DEST;
  watchCfg.build.watch = {};
  watchCfg.build.rollupOptions = {
    input:  watchInput,
    output: {
      format:         'esm',
      entryFileNames: '[name]-[hash].js',
      chunkFileNames: 'chunks/[name]-[hash].js',
      // See buildChunkingOutput() for CJS vs ESM branching rationale.
      ...buildChunkingOutput(viteCfg),
    },
    onwarn: suppressWarning,
    watch: {
      // Exclude build outputs and dependencies from Rollup's file watcher to
      // prevent feedback loops where writing a chunk triggers another rebuild.
      exclude: [
        path.join(CWD, 'public', '**'),
        path.join(CWD, 'node_modules', '**'),
        path.join(CLAY_DIR, '**'),
      ],
    },
  };

  const watcher = await vite.build(watchCfg);

  // Extract BUNDLE_END handling so the event callback stays below complexity limit.
  async function handleBundleEnd(event) {
    const output     = event.result;
    const viewOutput = output ? { output: output.output || [] } : null;
    const manifest   = buildManifest(viewOutput, kilnOutput);

    await writeManifest(manifest);
    await envCollector.write();
    if (onRebuild) onRebuild([]);
    console.log(clr.rebuilt('[js] Rebuilt successfully'));
    if (event.result && event.result.close) event.result.close();
  }

  watcher.on('event', async (event) => {
    if (event.code === 'BUNDLE_START') {
      console.log(clr.changed('[js] Rebuilding...'));
    } else if (event.code === 'BUNDLE_END') {
      await handleBundleEnd(event);
    } else if (event.code === 'ERROR') {
      console.error(clr.error(`[js] Build error: ${event.error.message}`));
      if (onRebuild) onRebuild([event.error]);
    }
  });

  // ── Chokidar: regenerate bootstrap when new client.js files appear ─────────

  const rebuildKilnDebounced = debounce(async () => {
    if (viteCfg.kilnSplit) return;

    try {
      await generateViteKilnEditEntry();
      kilnOutput = await runKilnBuild(viteCfg, [envCollector.plugin()]);
      await envCollector.write();
      console.log(clr.rebuilt('[kiln] Rebuilt'));
    } catch (e) {
      console.error(clr.error(`[kiln] Rebuild failed: ${e.message}`));
    }
  }, 200);

  const rebuildBootstrap = debounce(async (changedFile, eventType) => {
    if (!changedFile) return;

    console.log(clr.changed('[js] Changed: ') + clr.file(rel(changedFile)));

    // Regenerate the bootstrap when a new client.js is added (new component)
    // or when a global/js file changes (globals are statically imported).
    const isNewClientJs = eventType !== 'change' && changedFile.endsWith('client.js');
    const isGlobal      = changedFile.includes(`${path.sep}global${path.sep}`);

    if (isNewClientJs || isGlobal) await generateViteBootstrap();

    // Regenerate the kiln entry when a model or kiln registration file changes.
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

  // ── CSS watcher ──────────────────────────────────────────────────────────────
  const rebuildStyles = debounce((changedFile) => {
    if (changedFile) console.log(clr.changed('[styles] Changed: ') + clr.file(rel(changedFile)));
    return buildStyles(options)
      .then(() => console.log(clr.rebuilt('[styles] Rebuilt')))
      .catch(e => console.error(clr.error(`[styles] rebuild failed: ${e.message}`)));
  }, 200);

  const cssWatcher = chokidar.watch(STYLE_GLOBS, chokidarOpts);

  cssWatcher.on('change', rebuildStyles).on('add', rebuildStyles).on('unlink', rebuildStyles);

  // ── Font watcher ─────────────────────────────────────────────────────────────
  const rebuildFonts = debounce((changedFile) => {
    if (changedFile) console.log(clr.changed('[fonts] Changed: ') + clr.file(rel(changedFile)));
    return buildFonts()
      .then(() => console.log(clr.rebuilt('[fonts] Rebuilt')))
      .catch(e => console.error(clr.error(`[fonts] rebuild failed: ${e.message}`)));
  }, 200);

  const fontWatcher = chokidar.watch(FONTS_SRC_GLOB, chokidarOpts);

  fontWatcher.on('change', rebuildFonts).on('add', rebuildFonts).on('unlink', rebuildFonts);

  // ── Template watcher ─────────────────────────────────────────────────────────
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
 * codebase into a native ESM output.
 *
 * These are not real errors — they reflect the current state of the codebase
 * (CJS sources, circular dependencies, missing optional modules) and will
 * disappear naturally as files are migrated to ESM.
 *
 * @param {object}   warning
 * @param {function} warn
 */
// Warning codes that are always expected in a mixed CJS/ESM codebase and
// should not surface to the user.  Each code is explained inline.
const SUPPRESSED_WARNING_CODES = new Set([
  // Circular requires() are common in CJS codebases and handled safely by
  // strictRequires:'auto'.  They become non-issues once files are ESM.
  'CIRCULAR_DEPENDENCY',

  // CJS modules use `this` at the top level (equivalent to `module.exports`).
  // Rollup warns because in ESM `this` is undefined at the top level.
  // @rollup/plugin-commonjs wraps these so the reference is correct.
  'THIS_IS_UNDEFINED',

  // Some globals (e.g. jQuery's $) are expected to be on window and are not
  // imported.  Clay components reference them as free variables.
  'MISSING_GLOBAL_NAME',

  // Missing optional imports are stubbed by viteMissingModulePlugin.  Rollup
  // warns before the plugin catches them; the warning is spurious.
  'UNRESOLVED_IMPORT',

  // CJS modules wrapped by @rollup/plugin-commonjs may not export named
  // bindings.  Named imports from CJS modules get undefined — expected.
  'MISSING_EXPORT',
]);

function suppressWarning(warning, warn) {
  if (SUPPRESSED_WARNING_CODES.has(warning.code)) return;

  // eval() in node_modules (e.g. pyxis-frontend webpack dev bundle) is
  // intentional and cannot be removed.  Only warn for project source files.
  if (warning.code === 'EVAL' && warning.id && warning.id.includes('/node_modules/')) return;

  warn(warning);
}

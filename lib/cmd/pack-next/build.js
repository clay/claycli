'use strict';

const esbuild = require('esbuild');
const fs = require('fs-extra');
const { globSync } = require('glob');
const path = require('path');

const { getConfigValue } = require('../../config-file-helpers');
const serviceRewritePlugin = require('./plugins/service-rewrite');
const vue2Plugin = require('./plugins/vue2');
const { writeManifest } = require('./manifest');

const CWD = process.cwd();

// Mirror the same glob patterns used by the Browserify compile pipeline.
const ENTRY_GLOBS = [
  path.join(CWD, 'components', '**', 'client.js'),
  path.join(CWD, 'components', '**', 'model.js'),
  path.join(CWD, 'layouts', '**', 'client.js'),
  path.join(CWD, 'layouts', '**', 'model.js'),
  path.join(CWD, 'services', 'kiln', 'index.js'),
];

const DEST = path.join(CWD, 'public', 'js');

// Generated entry file that pre-populates window.kiln.componentModels,
// window.kiln.componentKilnjs, and calls the kiln plugin initializer so
// that clay-kiln's preload action finds everything it needs without the
// Browserify window.modules / window.require runtime.
const KILN_EDIT_ENTRY_DIR = path.join(CWD, '.clay');
const KILN_EDIT_ENTRY_FILE = path.join(KILN_EDIT_ENTRY_DIR, '_kiln-edit-init.js');

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

  await fs.ensureDir(KILN_EDIT_ENTRY_DIR);
  await fs.writeFile(KILN_EDIT_ENTRY_FILE, lines.join('\n'), 'utf8');

  return KILN_EDIT_ENTRY_FILE;
}

/**
 * Collect all default entry points from the standard Clay directory layout.
 * Includes the generated kiln edit-init aggregator if it exists on disk.
 *
 * @returns {string[]}
 */
function getDefaultEntryPoints() {
  const entries = ENTRY_GLOBS.flatMap(g => globSync(g));

  if (fs.existsSync(KILN_EDIT_ENTRY_FILE)) {
    entries.push(KILN_EDIT_ENTRY_FILE);
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

  const entryPoints = [
    ...getDefaultEntryPoints(),
    ...extraEntries,
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
      serviceRewritePlugin(),
      vue2Plugin(),
    ],

    define: {
      // Expose NODE_ENV to component code; do not bundle the full `process`
      // object (that was a Browserify behaviour via transformEnv).
      'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'development'),
    },

    // Target browsers that support native ESM. Adjust in claycli.config.js if
    // the project needs to support older browsers via a polyfill loader.
    target: ['chrome80', 'firefox78', 'safari14', 'edge80'],

    // Stub out Node.js built-ins (fs, crypto, etc.) automatically so that
    // server-only code that sneaks into component bundles fails gracefully
    // rather than crashing the build with unresolvable-module errors.
    platform: 'browser',

    logLevel: 'silent', // We print our own messages via the CLI handler.
  };

  // Allow consuming repos to extend the config via packNextConfig in claycli.config.js.
  // The customizer receives the plain config object and must return it (optionally modified).
  const customizer = getConfigValue('packNextConfig');

  if (typeof customizer === 'function') {
    const customized = customizer(config);

    if (customized && typeof customized === 'object') {
      return customized;
    }
  }

  return config;
}

/**
 * Run a one-shot esbuild build and write `_manifest.json`.
 *
 * @param {object}   [options]
 * @param {boolean}  [options.minify=false]
 * @param {string[]} [options.extraEntries=[]]
 * @returns {Promise}
 */
async function build(options = {}) {
  // Generate the kiln edit-mode aggregator before collecting entry points so
  // getDefaultEntryPoints() can pick it up from disk.
  await generateKilnEditEntry();

  const config = getEsbuildConfig(options);

  if (config.entryPoints.length === 0) {
    throw new Error(
      'pack-next: no entry points found.\n' +
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
 * Start an esbuild watch context that rebuilds on file changes.
 *
 * The returned context object has a `dispose()` method; call it to stop
 * watching (e.g. on SIGINT).
 *
 * @param {object}   [options]
 * @param {boolean}  [options.minify=false]
 * @param {string[]} [options.extraEntries=[]]
 * @param {function} [options.onRebuild] - Called after each rebuild with (errors, warnings).
 * @returns {Promise}
 */
async function watch(options = {}) {
  const { onRebuild } = options;

  await generateKilnEditEntry();

  const config = getEsbuildConfig(options);

  if (config.entryPoints.length === 0) {
    throw new Error(
      'pack-next: no entry points found.\n' +
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

  const ctx = await esbuild.context({
    ...config,
    plugins: [...config.plugins, manifestPlugin],
  });

  await ctx.watch();

  return ctx;
}

/**
 * The manifest key for the generated kiln edit-mode aggregator bundle.
 * Used by get-script-dependencies.js to look up the hashed URL.
 */
const KILN_EDIT_ENTRY_KEY = path.relative(CWD, KILN_EDIT_ENTRY_FILE).replace(/\\/g, '/').replace(/\.js$/, '');

module.exports = { build, watch, getEsbuildConfig, generateKilnEditEntry, KILN_EDIT_ENTRY_KEY };

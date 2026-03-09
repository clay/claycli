'use strict';

const path = require('path');
const fs = require('fs-extra');
const postcss = require('postcss');
const { globSync } = require('glob');
const { getConfigValue } = require('../../config-file-helpers');

const CWD = process.cwd();

const SRC_GLOBS = [
  path.join(CWD, 'styleguides', '**', 'components', '*.css'),
  path.join(CWD, 'styleguides', '**', 'layouts', '*.css'),
];

const DEST = path.join(CWD, 'public', 'css');

const ASSET_HOST = process.env.CLAYCLI_COMPILE_ASSET_HOST
  ? process.env.CLAYCLI_COMPILE_ASSET_HOST.replace(/\/$/, '')
  : '';
const ASSET_PATH = process.env.CLAYCLI_COMPILE_ASSET_PATH || '';

/**
 * Derive the output filename from the source path.
 * styleguides/{sg}/components/{name}.css → public/css/{name}.{sg}.css
 *
 * @param {string} srcPath
 * @returns {string}
 */
function getDestPath(srcPath) {
  const component = path.basename(srcPath, '.css');
  const parts = path.dirname(srcPath).split(path.sep);
  // parts: [..., 'styleguides', '{sg}', 'components'] → styleguide is at [-2]
  const styleguide = parts[parts.length - 2];

  return path.join(DEST, `${component}.${styleguide}.css`);
}

/**
 * Build the PostCSS plugin array based on the resolved config.
 *
 * @param {object} pluginConfig
 * @returns {Array}
 */
function buildPlugins(pluginConfig) {
  const cssImport = require('postcss-import');
  const autoprefixer = require('autoprefixer');
  const mixins = require('postcss-mixins');
  const simpleVars = require('postcss-simple-vars');
  const nested = require('postcss-nested');

  const variables = {
    'asset-host': ASSET_HOST,
    'asset-path': ASSET_PATH,
    minify: process.env.CLAYCLI_COMPILE_MINIFIED || process.env.CLAYCLI_COMPILE_MINIFIED_STYLES || '',
  };

  const importPaths = pluginConfig.importPaths || ['./styleguides'];
  const autoprefixerOptions = pluginConfig.autoprefixerOptions || {};
  const extraPlugins = pluginConfig.plugins || [];
  const shouldMinify = pluginConfig.minify || !!process.env.CLAYCLI_COMPILE_MINIFIED || false;

  const plugins = [
    cssImport({ path: importPaths, root: CWD }),
    autoprefixer(autoprefixerOptions),
    mixins(),
    // simple-vars before nested so variables resolve before nesting is parsed
    simpleVars({ variables }),
    nested(),
    ...extraPlugins,
  ];

  if (shouldMinify) {
    const cssnano = require('cssnano');

    plugins.push(cssnano({ preset: 'default' }));
  }

  return plugins;
}

/**
 * Compile a single CSS file with PostCSS.
 *
 * @param {string} srcPath - Absolute source path
 * @param {Array}  plugins - Pre-built PostCSS plugin array
 * @returns {Promise<string>} destination path
 */
async function compileFile(srcPath, plugins) {
  const source = await fs.readFile(srcPath, 'utf8');
  const destPath = getDestPath(srcPath);

  const result = await postcss(plugins).process(source, {
    from: srcPath,
    to: destPath,
    map: false,
  });

  await fs.ensureDir(path.dirname(destPath));
  await fs.writeFile(destPath, result.css, 'utf8');

  return destPath;
}

/**
 * Compile all CSS styleguide files using the PostCSS programmatic API.
 * Reads styleguides/**\/{components,layouts}\/*.css and writes to public/css/.
 *
 * Respects the `stylesConfig` hook in claycli.config.js (preferred) as well as
 * the legacy `postcssImportPaths` and `autoprefixerOptions` top-level keys.
 *
 * @param {object}   [options]
 * @param {boolean}  [options.minify=false]
 * @param {string[]} [options.changedFiles] - When set, only recompile these files
 *                                            instead of the full glob. The watcher
 *                                            passes all styleguide variants of the
 *                                            changed component name so that styleguides
 *                                            that @import the changed file are also rebuilt.
 * @param {function} [options.onProgress]   - Called with (doneCount, totalCount) after
 *                                            each file finishes (success or error).
 * @param {function} [options.onError]      - Called with (message) for each compile error.
 *                                            Defaults to console.error when not provided.
 * @returns {Promise<string[]>} list of output file paths
 */
async function buildStyles(options = {}) {
  const files = options.changedFiles
    ? options.changedFiles
    : SRC_GLOBS.flatMap(g => globSync(g));

  if (files.length === 0) return [];

  const { onProgress, onError } = options;
  const reportError = onError || (msg => console.error(msg));
  let doneCount = 0;

  // Seed config from legacy top-level keys for backwards compatibility
  const pluginConfig = {
    importPaths: getConfigValue('postcssImportPaths') || ['./styleguides'],
    autoprefixerOptions: getConfigValue('autoprefixerOptions') || {},
    plugins: [],
    minify: options.minify || !!process.env.CLAYCLI_COMPILE_MINIFIED || false,
  };

  // Apply the stylesConfig hook if present — it takes precedence
  const stylesConfigHook = getConfigValue('stylesConfig');

  if (typeof stylesConfigHook === 'function') {
    stylesConfigHook(pluginConfig);
  }

  const plugins = buildPlugins(pluginConfig);

  await fs.ensureDir(DEST);

  // Limit concurrency to avoid opening thousands of files simultaneously.
  // 50 is a practical sweet spot for ~2800 files: enough to keep the libuv
  // thread pool and CPU busy without triggering excessive GC pressure from
  // holding too many PostCSS ASTs in memory at once.
  const pLimit = require('p-limit');
  const limit = pLimit(50);

  const results = await Promise.all(
    files.map(f => limit(() =>
      compileFile(f, plugins)
        .then(dest => {
          doneCount++;
          if (onProgress) onProgress(doneCount, files.length);
          return dest;
        })
        .catch(err => {
          doneCount++;
          if (onProgress) onProgress(doneCount, files.length);
          reportError(`[styles] Error compiling ${path.relative(CWD, f)}: ${err.message}`);
          return null;
        })
    ))
  );

  return results.filter(Boolean);
}

module.exports = { buildStyles, SRC_GLOBS, getDestPath };

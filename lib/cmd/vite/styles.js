'use strict';

const os = require('os');
const path = require('path');
const fs = require('fs-extra');
const { globSync } = require('glob');
const { getConfigValue } = require('../../config-file-helpers');
const { resolveStylesConfig, resolveTargets, createCompiler } = require('./styles-compiler');

const CWD = process.cwd();

const SRC_GLOBS = [
  path.join(CWD, 'styleguides', '**', 'components', '*.css'),
  path.join(CWD, 'styleguides', '**', 'layouts', '*.css'),
];

const DEST = path.join(CWD, 'public', 'css');
const CSS_SITES_ENV = 'CLAYCLI_VITE_CSS_SITES';
const CSS_WORKERS_ENV = 'CLAYCLI_VITE_CSS_WORKERS';
const WORKER_PATH = path.join(__dirname, 'styles-worker.js');

// Starting a worker costs ~100 ms (it loads PostCSS, its plugins, Lightning CSS
// and claycli.config.js), so small builds compile on the main thread.
const MIN_FILES_FOR_WORKERS = 200;
// Leave cores for the js step, which runs alongside styles in a full build.
const MAX_WORKERS = 8;
// Files in flight per worker, so one file's I/O overlaps another's compile.
const JOBS_PER_WORKER = 4;

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
 * Global variables for postcss-simple-vars.
 *
 * @returns {object}
 */
function getCssVariables() {
  return {
    'asset-host': ASSET_HOST,
    'asset-path': ASSET_PATH,
    minify: process.env.CLAYCLI_COMPILE_MINIFIED || process.env.CLAYCLI_COMPILE_MINIFIED_STYLES || '',
  };
}

/**
 * Returns the styleguide slug from a styleguide source file path.
 * Example: /repo/styleguides/nymag/components/foo.css -> nymag
 *
 * @param {string} srcPath
 * @returns {string|null}
 */
function getStyleguideFromPath(srcPath) {
  const parts = srcPath.split(path.sep);
  const styleguidesIdx = parts.lastIndexOf('styleguides');

  if (styleguidesIdx === -1 || styleguidesIdx + 1 >= parts.length) return null;

  return parts[styleguidesIdx + 1] || null;
}

/**
 * Returns the set of explicitly-targeted styleguides for Vite CSS compilation.
 * Unset/empty/"all" means compile all styleguides.
 *
 * @returns {Set<string>|null}
 */
function getTargetCssSites() {
  const raw = (process.env[CSS_SITES_ENV] || '').trim();

  if (!raw || raw.toLowerCase() === 'all') return null;

  const sites = new Set(raw.split(',').map(s => s.trim()).filter(Boolean));

  // Most styleguides import shared defaults, so always include _default.
  sites.add('_default');
  return sites;
}

/**
 * How many worker threads compile a full build.  CLAYCLI_VITE_CSS_WORKERS sets
 * the count exactly (0 compiles on the main thread); otherwise one per available
 * core minus one, up to MAX_WORKERS, and none below MIN_FILES_FOR_WORKERS files.
 *
 * @param {number} fileCount
 * @returns {number}
 */
function getWorkerCount(fileCount) {
  const raw = (process.env[CSS_WORKERS_ENV] || '').trim();

  if (raw) return Math.min(Math.max(parseInt(raw, 10) || 0, 0), fileCount);
  if (fileCount < MIN_FILES_FOR_WORKERS) return 0;

  return Math.max(Math.min(os.availableParallelism() - 1, MAX_WORKERS), 0);
}

/**
 * Compile jobs on the main thread.
 *
 * @param {object[]} jobs    - { src, dest }
 * @param {object}   compiler - from createCompiler()
 * @param {function} settle  - (index, { errors, failure })
 * @returns {Promise<void>}
 */
async function compileInProcess(jobs, compiler, settle) {
  // Limit concurrency to avoid opening thousands of files simultaneously.
  const pLimit = require('p-limit');
  const limit = pLimit(50);

  await Promise.all(jobs.map((job, index) => limit(() =>
    compiler.compile(job.src, job.dest).then(
      ({ errors }) => settle(index, { errors }),
      err => settle(index, { failure: err.message })
    )
  )));
}

/**
 * Compile jobs across worker threads.  Each worker resolves claycli.config.js
 * from `root` itself; nothing chdirs.  A worker that crashes or fails to start
 * (e.g. the stylesConfig hook throws) rejects the step.
 *
 * @param {object[]} jobs       - { src, dest }
 * @param {number}   count      - worker threads to start
 * @param {object}   workerData - { root, minify, variables, targets }
 * @param {function} settle     - (index, { errors, failure })
 * @returns {Promise<void>}
 */
function compileInWorkers(jobs, count, workerData, settle) {
  const { Worker } = require('worker_threads');
  const workers = [];

  let next = 0,
    pending = jobs.length;

  return new Promise((resolve, reject) => {
    function dispatch(worker) {
      if (next >= jobs.length) return;

      const id = next++;

      worker.postMessage({ id, src: jobs[id].src, dest: jobs[id].dest });
    }

    for (let i = 0; i < count; i++) {
      const worker = new Worker(WORKER_PATH, { workerData });

      worker.on('message', ({ id, errors, failure }) => {
        settle(id, { errors, failure });
        if (--pending === 0) resolve();
        else dispatch(worker);
      });
      worker.on('error', reject);
      worker.on('exit', code => {
        if (pending > 0) reject(new Error(`styles worker exited early (code ${code})`));
      });
      workers.push(worker);
      for (let j = 0; j < JOBS_PER_WORKER; j++) dispatch(worker);
    }
  }).finally(() => Promise.all(workers.map(worker => worker.terminate())));
}

/**
 * The styleguide entry files to compile: the watcher's changedFiles as given,
 * else the full glob scoped to CLAYCLI_VITE_CSS_SITES.
 *
 * @param {object} options
 * @returns {string[]}
 */
function getStyleFiles(options) {
  // changedFiles is watcher-driven and already explicit, so it bypasses the site filter.
  if (options.changedFiles) return options.changedFiles;

  const files = SRC_GLOBS.flatMap(g => globSync(g));
  const targetSites = getTargetCssSites();

  if (!targetSites) return files;

  return files.filter(f => {
    const styleguide = getStyleguideFromPath(f);

    return styleguide && targetSites.has(styleguide);
  });
}

/**
 * clay vite does not run autoprefixer, and autoprefixer's overrideBrowserslist
 * is a usage share, not the browser floor Lightning CSS needs; say so rather
 * than drop the option silently.
 *
 * @param {object}   config
 * @param {function} reportWarning
 */
function warnAutoprefixerOptions(config, reportWarning) {
  if (Object.keys(config.autoprefixerOptions || {}).length) {
    reportWarning('[styles] autoprefixerOptions is ignored: Lightning CSS adds vendor prefixes for the ' +
      'browsers in .browserslistrc (or stylesConfig browserslist)');
  }
}

/**
 * Compile all CSS styleguide files: PostCSS (postcss-import, postcss-mixins,
 * postcss-simple-vars, postcss-nested, then any stylesConfig `plugins`) followed
 * by Lightning CSS for vendor prefixes and minification.  Reads
 * styleguides/**\/{components,layouts}\/*.css and writes to public/css/.
 *
 * Respects the `stylesConfig` hook in claycli.config.js (preferred) as well as
 * the legacy `postcssImportPaths` top-level key.
 *
 * Fails (after compiling everything else) when a file cannot be compiled or
 * has CSS that Lightning CSS cannot parse, which browsers ignore too.  Each
 * problem is reported once, at its source file and line.
 *
 * @param {object}   [options]
 * @param {boolean}  [options.minify=false]
 * @param {string[]} [options.changedFiles] - When set, only recompile these files
 *                                            instead of the full glob. The watcher
 *                                            passes all styleguide variants of the
 *                                            changed component name so that styleguides
 *                                            that @import the changed file are also rebuilt.
 *                                            Always compiled on the main thread.
 * @param {function} [options.onProgress]   - Called with (doneCount, totalCount) after
 *                                            each file finishes (success or error).
 * @param {function} [options.onError]      - Called with (message) for each error.
 *                                            Defaults to console.error when not provided.
 * @param {function} [options.onWarning]    - Called with (message) for configuration notices.
 *                                            Defaults to console.warn.
 * @returns {Promise<string[]>} list of output file paths
 */
async function buildStyles(options = {}) {
  const files = getStyleFiles(options);

  if (files.length === 0) return [];

  const { onProgress } = options;
  const reportError = options.onError || (msg => console.error(msg));
  const config = resolveStylesConfig(getConfigValue, options);
  const targets = resolveTargets(config, CWD);
  const variables = getCssVariables();
  const jobs = files.map(src => ({ src, dest: getDestPath(src) }));
  const results = new Array(jobs.length).fill(null);
  const invalid = new Map();
  const workerCount = options.changedFiles ? 0 : getWorkerCount(jobs.length);

  let doneCount = 0,
    failures = 0;

  warnAutoprefixerOptions(config, options.onWarning || (msg => console.warn(msg)));

  function settle(index, { errors, failure }) {
    doneCount++;
    if (onProgress) onProgress(doneCount, jobs.length);
    if (failure) {
      failures++;
      reportError(`[styles] Error compiling ${path.relative(CWD, jobs[index].src)}: ${failure}`);
      return;
    }
    results[index] = jobs[index].dest;
    errors.forEach(e => {
      const key = `${e.file}:${e.line}:${e.column}: ${e.message}`;

      invalid.set(key, (invalid.get(key) || 0) + 1);
    });
  }

  await fs.ensureDir(DEST);

  if (workerCount > 0) {
    await compileInWorkers(jobs, workerCount, { root: CWD, minify: options.minify, variables, targets }, settle);
  } else {
    await compileInProcess(jobs, createCompiler({ root: CWD, config, variables, targets }), settle);
  }

  // One line per source location, however many output files @import it.
  [...invalid.keys()].sort().forEach(key => {
    const count = invalid.get(key);

    reportError(`[styles] Invalid CSS in ${key}${count > 1 ? ` (${count} output files)` : ''}`);
  });

  if (failures || invalid.size) {
    throw new Error(`${failures + invalid.size} CSS error(s): ${failures} file(s) failed, ` +
      `${invalid.size} invalid declaration(s) or selector(s)`);
  }

  return results.filter(Boolean);
}

module.exports = { buildStyles, SRC_GLOBS, getDestPath };

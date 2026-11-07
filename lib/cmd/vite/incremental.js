'use strict';

/**
 * Incremental JS builds for `clay vite --only js --changed <files>`.
 *
 * The JS step is two independent Rollup passes (see scripts.js): the view pass bundles the bootstrap
 * and every component and layout client.js into chunks, and the Kiln pass bundles every model.js,
 * kiln.js and Kiln plugin into one file. Most edits feed only one of them, yet a full build runs
 * both (about 15 s and 2.2 GB peak in a branch pod, against 6.5 s / 1.4 GB for the view pass alone
 * and 9.5 s / 1.7 GB for the Kiln pass alone).
 *
 * After every pass this module records which source modules the pass bundled, which files it wrote
 * and which env names its code reads, in .clay/vite-deps.json, together with a fingerprint of the
 * build config. A later build that is told what changed looks each file up and rebuilds only the
 * passes that bundled it. Anything it cannot place (a new file, a file outside the project, no index
 * from an earlier build, a manifest or output that is not all there, a different build config or set
 * of installed dependencies) rebuilds both, so the shortcut can only ever skip work that provably
 * cannot change the output.
 */

const crypto = require('crypto');
const fs = require('fs-extra');
const path = require('path');

const kilnCss = require('./plugins/kiln-css');

const CWD = process.cwd();
const INDEX_FILE = path.join(CWD, '.clay', 'vite-deps.json');
const INDEX_VERSION = 1;
const PASSES = ['view', 'kiln'];
// What each package manager leaves in node_modules to record what is installed, in the order tried.
const INSTALL_RECORDS = ['node_modules/.package-lock.json', 'node_modules/.yarn-integrity', 'node_modules/.modules.yaml'];

/**
 * Turn a path into the form the index stores: relative to the project, forward slashes.
 *
 * @param {string} file - Absolute or project-relative path.
 * @param {string} [cwd=CWD] - Project root.
 * @returns {string} Normalized relative path.
 */
function normalizeFile(file, cwd = CWD) {
  const absolute = path.isAbsolute(file) ? file : path.join(cwd, file);

  return path.relative(cwd, absolute).split(path.sep).join('/');
}

/**
 * Keep the module ids that are project source files. Virtual modules (a leading NUL), query
 * suffixes, files outside the project and anything in node_modules are dropped: a change to what is
 * installed is caught by the dependency state in the build fingerprint instead.
 *
 * @param {Iterable<string>} ids - Module ids from Rollup.
 * @param {string} [cwd=CWD] - Project root.
 * @returns {string[]} Sorted, unique project-relative paths.
 */
function projectModules(ids, cwd = CWD) {
  const files = new Set();

  for (const id of ids) {
    const clean = id.replace(/^\0/, '').replace(/\?.*$/, '');

    if (!path.isAbsolute(clean)) continue;

    const relative = normalizeFile(clean, cwd);

    if (relative.startsWith('..') || relative.split('/').includes('node_modules')) continue;
    files.add(relative);
  }

  return [...files].sort();
}

/**
 * A Rollup plugin that records every module of one pass, including modules tree-shaken out of the
 * output: a later edit to one of those can start to matter, so it must still count as "in" the pass.
 *
 * It also keeps the Kiln plugin CSS blocks of the .vue files among them (see plugins/kiln-css.js).
 *
 * @returns {{plugin: function(): object, modules: function(): string[], css: function(): object}} The
 *   plugin factory, the recorded modules and the .vue files' style blocks.
 */
function createModuleCollector() {
  const seen = { ids: [], css: {} };

  return {
    plugin() {
      return {
        name: 'clay-vite-module-collector',
        buildEnd() {
          seen.ids = [...this.getModuleIds()];
          // Every .vue file has been transformed by now, so its style blocks are in the shared map.
          seen.css = kilnCss.collectedFor(seen.ids);
        },
      };
    },
    modules() {
      return projectModules(seen.ids);
    },
    css() {
      return seen.css;
    },
  };
}

/**
 * What the index keeps about one finished pass. Rollup lists a chunk's sourcemap among the output
 * assets, so the files include the .map files and --clean never takes a live chunk's map for stale.
 *
 * @param {object} output - The pass's Rollup output ({ output: [{ fileName }] }).
 * @param {string[]} modules - Project modules the pass bundled.
 * @param {string[]} [env=[]] - Env var names the pass's code reads.
 * @param {object} [css={}] - Style blocks of the .vue files the pass bundled, by relative path.
 * @returns {{modules: string[], files: string[], env: string[], css: object}} Modules bundled, files
 *   written (relative to public/js), env names read and Kiln plugin CSS collected.
 */
function describePass(output, modules, env = [], css = {}) {
  return {
    modules,
    files: output.output.map(item => item.fileName).sort(),
    env: [...new Set(env)].sort(),
    css,
  };
}

/**
 * A copy of a value that serializes the same whatever order its keys were set in: object keys are
 * sorted, functions (plugins, hooks) become their source, and a value that contains itself becomes
 * a marker.
 *
 * @param {*} value - Any config value.
 * @param {Set<object>} [ancestors] - The objects on the way down, to cut cycles.
 * @returns {*} A JSON-safe copy.
 */
function canonical(value, ancestors = new Set()) {
  if (typeof value === 'function') return `function:${Function.prototype.toString.call(value)}`;
  if (value instanceof RegExp) return `regexp:${value}`;
  if (!value || typeof value !== 'object') return value;
  if (ancestors.has(value)) return '[circular]';

  ancestors.add(value);

  const copy = Array.isArray(value)
    ? value.map(item => canonical(item, ancestors))
    : Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key], ancestors)]));

  ancestors.delete(value);
  return copy;
}

/**
 * A short hash of what is installed in node_modules, taken from the record the package manager leaves
 * there (npm's hidden lockfile, Yarn's integrity file, pnpm's modules file). A reinstall that changes
 * it can change what the pass a partial build skips would bundle.
 *
 * @param {string} [cwd=CWD] - Project root.
 * @returns {string|null} 16 hex characters, or null when no package manager left a record.
 */
function dependencyState(cwd = CWD) {
  for (const record of INSTALL_RECORDS) {
    try {
      return crypto.createHash('sha256').update(fs.readFileSync(path.join(cwd, record))).digest('hex').slice(0, 16);
    } catch (error) {
      // Not this package manager's record: try the next one.
    }
  }

  return null;
}

/**
 * A short hash of what shapes the output of a JS build besides the source files: the resolved
 * bundler config (aliases, defines, plugins, extra entries, minify, sourcemap), the env vars that
 * change the output, the installed dependencies and the claycli version. A partial build may only
 * reuse the pass it skips when this is the hash the index was written with, else that pass's files
 * were built under other options.
 *
 * @param {object} inputs - What to hash.
 * @returns {string|null} 16 hex characters, or null when the inputs cannot be serialized (such a
 *   build never takes the shortcut).
 */
function fingerprint(inputs) {
  try {
    return crypto.createHash('sha256').update(JSON.stringify(canonical(inputs))).digest('hex').slice(0, 16);
  } catch (error) {
    return null;
  }
}

/**
 * Every env var name the browser code reads: the union of what each pass recorded. Taken from the
 * index after a build, so a partial build replaces the names of the pass it ran and keeps the other's.
 *
 * @param {object} index - The index after this build.
 * @returns {string[]} Sorted, unique names.
 */
function envNames(index) {
  return [...new Set(PASSES.flatMap(pass => index[pass] ? index[pass].env || [] : []))].sort();
}

/**
 * Read the index an earlier build left behind.
 *
 * @param {string} [file=INDEX_FILE] - Index path.
 * @returns {object|null} The index, or null when missing, unreadable or from another version.
 */
function readIndex(file = INDEX_FILE) {
  try {
    const index = fs.readJsonSync(file);

    return index && index.version === INDEX_VERSION ? index : null;
  } catch (error) {
    return null;
  }
}

/**
 * Save the index. A failure only costs the next build its shortcut, so it never fails a build.
 *
 * @param {object} index - Index to write.
 * @param {string} [file=INDEX_FILE] - Index path.
 * @returns {boolean} Whether it was written.
 */
function writeIndex(index, file = INDEX_FILE) {
  try {
    fs.outputJsonSync(file, { ...index, version: INDEX_VERSION });
    return true;
  } catch (error) {
    return false;
  }
}

/**
 * Whether the last build's index can stand in for the pass a partial build skips: it describes both
 * passes (modules, env names and CSS) and was written under the same build config.
 *
 * @param {object|null} index - The last build's index.
 * @param {string|null} config - The current build config's fingerprint.
 * @returns {boolean} True when it can.
 */
function isReusable(index, config) {
  if (!config || !index || index.config !== config) return false;

  return PASSES.every(pass => index[pass] && Array.isArray(index[pass].modules) && Array.isArray(index[pass].env) && index[pass].css && typeof index[pass].css === 'object');
}

/**
 * Whether a partial build can leave the skipped passes' output alone: the manifest still holds each
 * skipped pass's entry, and every file the index recorded for those passes is still on disk.
 *
 * @param {string[]} skipped - The passes the build would skip.
 * @param {object} state - { manifest (parsed, or null), index, keys (manifest key of each pass's
 *   entry), dest (the JS output folder) }.
 * @returns {boolean} True when the output is all there.
 */
function keepsOutput(skipped, { manifest, index, keys, dest }) {
  return skipped.every(pass => {
    const entry = manifest && manifest[keys[pass]];
    const files = index[pass].files;

    return Boolean(entry && typeof entry.file === 'string') && Array.isArray(files) && files.every(file => fs.existsSync(path.join(dest, file)));
  });
}

/**
 * The Kiln plugin CSS the skipped passes collected in their last build, to put back before a partial
 * build runs (see kiln-css.js).
 *
 * @param {object} index - The last build's index.
 * @param {string[]} skipped - The passes the build skips.
 * @returns {object} Relative .vue path to its style blocks.
 */
function skippedCss(index, skipped) {
  return Object.assign({}, ...skipped.map(pass => index[pass].css));
}

/**
 * Delete the index. A build calls this before its passes start writing and writes the new index
 * last, so an index on disk always describes a finished build: one that fails or stops halfway (a
 * pass can write its output while the other pass fails), or whose index cannot be written, leaves
 * none, and the next build runs both passes instead of trusting an index that no longer matches the
 * output.
 *
 * @param {string} [file=INDEX_FILE] - Index path.
 */
function clearIndex(file = INDEX_FILE) {
  try {
    fs.removeSync(file);
  } catch (error) {
    // If it cannot be removed, writing the new one replaces it.
  }
}

/**
 * Decide which passes a build must run.
 *
 * @param {string[]|undefined} changed - Files that changed since the last build, or undefined for a full build.
 * @param {object|null} index - The last build's index.
 * @param {boolean} hasManifest - Whether a manifest exists to keep the other pass's entries from.
 * @param {string|null} config - Fingerprint of the current build config (see fingerprint()).
 * @returns {string[]} The passes to run: ['view'], ['kiln'] or both.
 */
function choosePasses(changed, index, hasManifest, config) {
  if (!changed || !changed.length || !hasManifest) return PASSES;
  if (!isReusable(index, config)) return PASSES;

  const known = {};
  const files = changed.map(file => normalizeFile(file));

  PASSES.forEach(pass => {
    known[pass] = new Set(index[pass].modules);
  });

  // A file neither pass bundled is new, or only read through a glob: both entries may change.
  if (files.some(file => !PASSES.some(pass => known[pass].has(file)))) return PASSES;

  return PASSES.filter(pass => files.some(file => known[pass].has(file)));
}

/**
 * Combine a partial build's manifest entries with the other pass's entries from the last manifest.
 * The Kiln pass owns exactly one key; every other key belongs to the view pass.
 *
 * @param {object|null} existing - The manifest on disk before this build.
 * @param {object} fresh - Entries from the passes that just ran.
 * @param {string[]} rebuilt - The passes that ran.
 * @param {string} kilnKey - The manifest key of the Kiln entry.
 * @returns {object} The merged manifest.
 */
function mergeManifest(existing, fresh, rebuilt, kilnKey) {
  const kept = {};

  Object.keys(existing || {}).forEach(key => {
    const pass = key === kilnKey ? 'kiln' : 'view';

    if (!rebuilt.includes(pass)) kept[key] = existing[key];
  });

  return { ...kept, ...fresh };
}

/**
 * The passes that make up a whole build, when the index records every one of them. The index names
 * them (`passes`: both, or only the view pass under kilnSplit); one without that field is read as both.
 *
 * @param {object|null} index - The index after this build.
 * @returns {string[]|null} Pass names, or null when the index is missing, names no pass, or lacks one.
 */
function recordedPasses(index) {
  if (!index) return null;

  const passes = Array.isArray(index.passes) ? index.passes : PASSES;

  return passes.length && passes.every(pass => index[pass] && Array.isArray(index[pass].files)) ? passes : null;
}

/**
 * Files under public/js/chunks and public/js/.clay that no pass's last build wrote. Those folders
 * only ever hold JS pass output, so everything the passes did not list there is left over from an
 * earlier build (Rollup never deletes it). Nothing is listed unless every pass of a whole build is
 * recorded, so a half-known index never takes live files for stale.
 *
 * @param {object|null} index - The index after this build.
 * @param {string[]} onDisk - Files found in those folders, relative to public/js.
 * @returns {string[]} Files that are safe to delete; empty when a pass is unknown.
 */
function staleFiles(index, onDisk) {
  const passes = recordedPasses(index);

  if (!passes) return [];

  const live = new Set(passes.flatMap(pass => index[pass].files));

  return onDisk.filter(file => !live.has(file));
}

/**
 * Delete the files staleFiles() finds.
 *
 * @param {object|null} index - The index after this build.
 * @param {string} dest - The JS output folder (public/js).
 * @returns {Promise<number>} How many files were deleted.
 */
async function pruneStale(index, dest) {
  const onDisk = [];

  for (const folder of ['chunks', '.clay']) {
    if (!await fs.pathExists(path.join(dest, folder))) continue;
    for (const name of await fs.readdir(path.join(dest, folder))) {
      const relative = `${folder}/${name}`;

      if ((await fs.stat(path.join(dest, relative))).isFile()) onDisk.push(relative);
    }
  }

  const stale = staleFiles(index, onDisk);

  await Promise.all(stale.map(file => fs.remove(path.join(dest, file))));
  return stale.length;
}

module.exports = {
  INDEX_FILE,
  INDEX_VERSION,
  PASSES,
  choosePasses,
  clearIndex,
  createModuleCollector,
  dependencyState,
  describePass,
  envNames,
  fingerprint,
  keepsOutput,
  mergeManifest,
  normalizeFile,
  projectModules,
  pruneStale,
  readIndex,
  skippedCss,
  staleFiles,
  writeIndex,
};

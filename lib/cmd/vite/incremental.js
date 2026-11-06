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
 * After every pass this module records which source modules the pass bundled and which files it
 * wrote, in .clay/vite-deps.json. A later build that is told what changed looks each file up and
 * rebuilds only the passes that bundled it. Anything it cannot place (a new file, a file outside
 * the project, no index from an earlier build, no manifest) rebuilds both, so the shortcut can only
 * ever skip work that provably cannot change the output.
 */

const fs = require('fs-extra');
const path = require('path');

const CWD = process.cwd();
const INDEX_FILE = path.join(CWD, '.clay', 'vite-deps.json');
const INDEX_VERSION = 1;
const PASSES = ['view', 'kiln'];

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
 * suffixes, files outside the project and anything in node_modules are dropped: a dependency change
 * needs a fresh install and a full build anyway.
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
 * @returns {{plugin: function(): object, modules: function(): string[]}} The plugin factory and the recorded modules.
 */
function createModuleCollector() {
  let ids = [];

  return {
    plugin() {
      return {
        name: 'clay-vite-module-collector',
        buildEnd() {
          ids = [...this.getModuleIds()];
        },
      };
    },
    modules() {
      return projectModules(ids);
    },
  };
}

/**
 * What the index keeps about one finished pass.
 *
 * @param {object} output - The pass's Rollup output ({ output: [{ fileName }] }).
 * @param {string[]} modules - Project modules the pass bundled.
 * @returns {{modules: string[], files: string[]}} Modules bundled and files written (relative to public/js).
 */
function describePass(output, modules) {
  return {
    modules,
    files: output.output.map(item => item.fileName).sort(),
  };
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
 * Decide which passes a build must run.
 *
 * @param {string[]|undefined} changed - Files that changed since the last build, or undefined for a full build.
 * @param {object|null} index - The last build's index.
 * @param {boolean} hasManifest - Whether a manifest exists to keep the other pass's entries from.
 * @returns {string[]} The passes to run: ['view'], ['kiln'] or both.
 */
function choosePasses(changed, index, hasManifest) {
  if (!changed || !changed.length || !hasManifest) return PASSES;
  if (!index || !PASSES.every(pass => index[pass] && Array.isArray(index[pass].modules))) return PASSES;

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
 * Files under public/js/chunks and public/js/.clay that no pass's last build wrote. Those folders
 * only ever hold JS pass output, so everything the passes did not list there is left over from an
 * earlier build (Rollup never deletes it).
 *
 * @param {object|null} index - The index after this build.
 * @param {string[]} onDisk - Files found in those folders, relative to public/js.
 * @returns {string[]} Files that are safe to delete; empty when either pass is unknown.
 */
function staleFiles(index, onDisk) {
  if (!index || !PASSES.every(pass => index[pass] && Array.isArray(index[pass].files))) return [];

  const live = new Set(PASSES.flatMap(pass => index[pass].files));

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

/**
 * Add two lists of environment variable names, for a partial build that only saw one pass's code.
 *
 * @param {string[]} previous - Names from the last client-env.json.
 * @param {string[]} found - Names this build found.
 * @returns {string[]} Sorted union.
 */
function unionEnvNames(previous, found) {
  return [...new Set([...previous, ...found])].sort();
}

module.exports = {
  INDEX_FILE,
  INDEX_VERSION,
  PASSES,
  choosePasses,
  createModuleCollector,
  describePass,
  mergeManifest,
  normalizeFile,
  projectModules,
  pruneStale,
  readIndex,
  staleFiles,
  unionEnvNames,
  writeIndex,
};

'use strict';

const path = require('path');

const CWD = process.cwd();
const KILN_CSS_DEST = path.join(CWD, 'public', 'css', '_kiln-plugins.css');

// <style> blocks per .vue file, keyed by the module id (the absolute path). Shared across every
// viteVue2Plugin() instance in this process (see the "CSS accumulation note" in vue2.js), so
// re-transforming a file (a rebuilt pass, a watch rebuild) replaces its blocks instead of appending
// a second copy.
const cssByFile = new Map();

/**
 * A module id as a path relative to the project root, with forward slashes.
 *
 * @param {string} id - Absolute module id.
 * @returns {string} The relative path.
 */
function relativeId(id) {
  return path.relative(CWD, id).split(path.sep).join('/');
}

/**
 * Record the style blocks of a .vue file. A file with none drops its entry, so removing its last
 * <style> block takes the CSS out on the next build.
 *
 * @param {string} id - Module id of the .vue file.
 * @param {string[]} blocks - Raw CSS, one string per non-empty <style> block.
 */
function setBlocks(id, blocks) {
  if (blocks.length) cssByFile.set(id, blocks);
  else cssByFile.delete(id);
}

/**
 * The blocks of the .vue files among some module ids, keyed by path relative to the project: what
 * the build index keeps for each pass.
 *
 * @param {Iterable<string>} ids - Module ids a pass bundled.
 * @returns {object} Relative path to that file's blocks.
 */
function collectedFor(ids) {
  const found = {};

  for (const id of ids) {
    if (cssByFile.has(id)) found[relativeId(id)] = cssByFile.get(id);
  }

  return found;
}

/**
 * Put back blocks an earlier build collected for a pass that a partial build skips. Nothing
 * transforms those .vue files in this process, yet the file render() produces must still hold their
 * CSS.
 *
 * @param {object} byRelativeFile - Relative path to that file's blocks, as collectedFor returns.
 */
function seed(byRelativeFile) {
  Object.entries(byRelativeFile).forEach(([file, blocks]) => cssByFile.set(path.join(CWD, file), blocks));
}

/**
 * _kiln-plugins.css content: every collected <style> block, files in path order relative to the
 * project root. Transforms finish in whatever order their async PostCSS runs complete, so insertion
 * order is not stable from one build to the next; path order is, and it doesn't depend on where the
 * project is checked out.
 *
 * @returns {{css: string, blocks: number}} The file's text and how many blocks it holds.
 */
function render() {
  // Plain code-unit order (Array#sort's default), not localeCompare, which
  // depends on the build machine's locale.
  const files = [...cssByFile.keys()].map(id => [relativeId(id), id]).sort().map(([, id]) => id);
  const blocks = files.flatMap(id => cssByFile.get(id));

  return { css: blocks.join('\n'), blocks: blocks.length };
}

module.exports = { KILN_CSS_DEST, collectedFor, render, seed, setBlocks };

'use strict';

const path = require('path');

/**
 * Rollup manualChunks factory — controls how modules are grouped into output
 * files.
 *
 * ── Why this plugin exists ───────────────────────────────────────────────────
 *
 * The legacy Browserify pipeline produced a handful of large monolithic bundles.
 * Without this plugin, Rollup's default code-splitting would go to the opposite
 * extreme: every shared module gets its own file, producing hundreds of tiny
 * chunks.  Hundreds of tiny HTTP/2 requests still have overhead — each ESM
 * module link adds a microtask boundary, and the browser's module linker must
 * resolve all imports before execution begins.
 *
 * This plugin sits between the two extremes: small private dependencies are
 * folded back into their owner's chunk (eliminating the round-trip cost for
 * code that was never shared to begin with), while genuinely shared modules
 * keep their own dedicated chunk so they can be cached independently.
 *
 * ── Chunking strategy (three rules, applied in order) ───────────────────────
 *
 *   Rule 1 — Entries are untouchable.
 *     Static entries (the bootstrap) and dynamic entries (component client.js
 *     files loaded via import()) must always be their own output chunk.
 *     Merging them into another chunk would change their URL, breaking the
 *     manifest and runtime loader.
 *
 *   Rule 2 — Private deps are inlined into their owner.
 *     If a module has exactly one static importer AND its source is smaller
 *     than manualChunksMinSize, it is inlined by assigning it the same chunk
 *     name as its owning entry.  "Private" means it will never be cached
 *     separately anyway (no other page would request it), so inlining saves
 *     a round-trip with zero cache-hit penalty.
 *
 *     The ownership walk (findOwnerEntry) follows the static importer chain
 *     upward until an entry is reached.  If the chain forks (shared) or cycles,
 *     it returns null and the module falls through to Rule 3.
 *
 *   Rule 3 — Everything else: let Rollup decide.
 *     Shared modules (more than one importer) get their own chunk via Rollup's
 *     default splitting.  Each shared chunk gets a content-hashed filename so
 *     it can be cached independently across deploys.
 *
 *     Deliberately NO bucket grouping (e.g. vendor/ or a-d/ buckets): grouping
 *     unrelated modules together to reduce chunk count creates circular chunk
 *     dependencies when one bucket references another, causing "X is not a
 *     function" runtime errors.  Let Rollup assign one chunk per shared module;
 *     the content-hash ensures caching still works well.
 *
 * ── ESM migration note ───────────────────────────────────────────────────────
 *
 * This plugin operates on source code length (info.code.length) as a byte-size
 * proxy.  As files migrate from CJS (which includes wrapper boilerplate) to
 * native ESM, their compiled code shrinks.  More modules will naturally fall
 * below manualChunksMinSize and get inlined, reducing chunk count further
 * without any configuration change.
 *
 * @param {number} [manualChunksMinSize=8192]  byte threshold (source code length);
 *   modules below this with a single importer are candidates for inlining.
 *   Set 0 to disable private-dep inlining and let Rollup split at every boundary.
 * @param {string} [cwd=process.cwd()]  root directory for relative chunk names
 * @returns {function} manualChunks function for rollupOptions.output.manualChunks
 */
function viteManualChunksPlugin(manualChunksMinSize = 8192, cwd = process.cwd()) {
  return function manualChunks(id, { getModuleInfo }) {
    // Skip Rollup virtual modules (ids starting with \0 are internal helpers
    // like the commonjs proxy modules).  Assigning them a chunk name would
    // break Rollup's internal module resolution.
    if (id.startsWith('\0')) return undefined;

    const info = getModuleInfo(id);

    if (!info) return undefined;

    // Rule 1: entry modules (static or dynamic) are always their own chunk.
    // Dynamic entries are the component client.js files loaded via import().
    if (info.isEntry || info.isDynamicEntry) return undefined;

    const importers = info.importers || [];
    // info.code is the post-transform source; its length is a reasonable proxy
    // for the minified+gzipped byte cost of including this module in a chunk.
    const isSmall = info.code != null && info.code.length < manualChunksMinSize;

    // Rule 2: private dep (exactly one static importer, below size threshold).
    // Walk up the importer chain to find the owning entry, then assign this
    // module to that entry's chunk so they are emitted in the same file.
    if (importers.length === 1 && isSmall) {
      const owner = findOwnerEntry(importers[0], getModuleInfo, new Set([id]));

      if (owner) return toChunkName(owner, cwd);
    }

    // Rule 3: shared or large module — let Rollup create a dedicated chunk.
    return undefined;
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Walk up the static importer chain until we reach an entry module (static
 * or dynamic).  Returns null if the chain splits (module is shared by more
 * than one importer) or cycles (circular dependency).
 *
 * The visited set prevents infinite loops on circular import graphs, which
 * occur in CJS codebases where A requires B and B requires A.
 *
 * @param {string}   startId
 * @param {function} getModuleInfo
 * @param {Set}      visited
 * @returns {string|null}
 */
function findOwnerEntry(startId, getModuleInfo, visited) {
  if (visited.has(startId)) return null;
  visited.add(startId);

  if (startId.startsWith('\0')) return null;

  const info = getModuleInfo(startId);

  if (!info) return null;

  // Reached an entry — this is the owner.
  if (info.isEntry || info.isDynamicEntry) return startId;

  const importers = info.importers || [];

  // The chain splits — this module is shared, so it cannot be inlined
  // exclusively into any single entry.
  if (importers.length !== 1) return null;

  return findOwnerEntry(importers[0], getModuleInfo, visited);
}

/**
 * Convert an absolute module path to a safe relative string for use as the
 * [name] token in Rollup's chunkFileNames pattern.
 *
 * Example:
 *   /home/app/components/nav/client.js  →  components/nav/client
 *
 * The leading path is stripped, the extension is removed, and Windows
 * backslashes are normalised to forward slashes.
 *
 * @param {string} absoluteId
 * @param {string} cwd
 * @returns {string}
 */
function toChunkName(absoluteId, cwd) {
  return path.relative(cwd, absoluteId)
    .replace(/\.[^./\\]+$/, '')
    .replace(/\\/g, '/');
}

module.exports = viteManualChunksPlugin;

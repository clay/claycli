'use strict';

const path = require('path');

/**
 * Rollup manualChunks function factory.
 *
 * Returns a manualChunks function that merges small *dependency* modules back
 * into their sole importer's chunk rather than emitting them as separate files.
 * Entry points (e.g. component client.js files) are never merged so that
 * _view-init's dynamic import() loaders and the mount runtime keep working.
 *
 * This is the primary reason for the Rollup port: esbuild always splits at
 * shared-module boundaries regardless of size, producing hundreds of tiny
 * chunk files. Rollup's manualChunks lets us inline modules that are only
 * used by one entry point and below a configurable byte threshold back into
 * their importer, matching the bundle shape users expect from webpack-style bundlers.
 *
 * HOW IT WORKS
 * ------------
 * Returning a string from manualChunks assigns module `id` to a named chunk.
 * We walk up the sole-importer chain until we reach an entry module, then
 * return that entry module's sanitized name as the chunk key.  This causes
 * Rollup to place the small module directly into its importer's output file
 * rather than emitting it as a separate chunk.
 *
 * IMPORTANT: The returned string must be a RELATIVE PATH without extension
 * (not an absolute path), because Rollup uses it as the [name] placeholder
 * in chunkFileNames patterns like "chunks/[name]-[hash].js".  Absolute paths
 * are invalid there and cause a build error.
 *
 * Returning `undefined` (not null) means "use Rollup's automatic splitting".
 * Note: returning `null` is NOT the same as returning `undefined` — null
 * triggers an error in some Rollup versions.
 *
 * @param {number} [minChunkSize=4096] - Minimum byte size for a standalone chunk.
 *   Modules smaller than this threshold with only a single importer are merged
 *   into that importer's chunk.
 * @param {string} [cwd=process.cwd()] - Base directory for making paths relative.
 * @returns {function} - manualChunks function to pass in Rollup output options
 */
function manualChunksPlugin(minChunkSize = 4096, cwd = process.cwd()) {
  return function manualChunks(id, { getModuleInfo }) {
    // Skip virtual modules (\0-prefixed IDs from plugins like commonjs, browser-compat, etc.)
    // Their absolute-path IDs would cause invalid chunk names if returned.
    if (id.startsWith('\0')) return undefined;

    const info = getModuleInfo(id);

    if (!info) return undefined;

    // Never collapse entry points (static or dynamic) — client.js files are
    // dynamic entries whose chunk URLs must stay resolvable by the mount runtime.
    if (info.isEntry || info.isDynamicEntry) return undefined;

    // Only collapse modules that are referenced by exactly one importer and
    // whose source code is below the threshold. Shared modules (importers > 1)
    // must stay as their own chunk so each importer gets a cache hit.
    if (
      info.importers &&
      info.importers.length === 1 &&
      info.code &&
      info.code.length < minChunkSize
    ) {
      // Walk up the importer chain to find the entry chunk this module
      // ultimately belongs to.  We return a sanitized relative name derived
      // from the entry module's ID so Rollup can use it safely in [name].
      const entryId = findEntryId(info.importers[0], getModuleInfo, new Set([id]));

      if (entryId) {
        return sanitizeChunkName(entryId, cwd);
      }
    }

    return undefined;
  };
}

/**
 * Walk up the importer chain from startId until we reach an entry module.
 * Returns the entry module's raw ID, or null if no entry is reachable (e.g.
 * circular graph or the importer chain has multiple branches at some level).
 *
 * Iterative implementation (avoids potential stack overflow on very deep but
 * linear dependency chains that would exhaust the JS call stack recursively).
 *
 * @param {string}   startId
 * @param {function} getModuleInfo
 * @param {Set}      visited - cycle guard (pre-seeded with the leaf module)
 * @returns {string|null}
 */
function findEntryId(startId, getModuleInfo, visited) {
  let currentId = startId;

  while (true) {
    if (visited.has(currentId)) return null;
    visited.add(currentId);

    // Skip virtual modules during upward traversal
    if (currentId.startsWith('\0')) return null;

    const info = getModuleInfo(currentId);

    if (!info) return null;

    // Found an entry point (static or dynamic) — this is the chunk to assign to
    if (info.isEntry || info.isDynamicEntry) return currentId;

    // If this intermediate module has exactly one importer, keep walking up
    if (info.importers && info.importers.length === 1) {
      currentId = info.importers[0];
    } else {
      // Multiple importers or no importers and not an entry — can't inline safely
      return null;
    }
  }
}

/**
 * Convert an absolute module ID into a safe relative chunk name for use
 * as the [name] placeholder in chunkFileNames patterns.
 *
 * @param {string} absoluteId
 * @param {string} cwd
 * @returns {string}
 */
function sanitizeChunkName(absoluteId, cwd) {
  // Make path relative to CWD
  let rel = path.relative(cwd, absoluteId);

  // Strip file extension
  rel = rel.replace(/\.[^./\\]+$/, '');

  // Normalize separators to forward slash (Windows safety)
  rel = rel.replace(/\\/g, '/');

  return rel;
}

module.exports = manualChunksPlugin;

'use strict';

/**
 * Rollup manualChunks function factory.
 *
 * Returns a manualChunks function that merges small chunks back into their
 * largest importer rather than emitting them as separate files.
 *
 * This is the primary reason for the Rollup port: esbuild always splits at
 * shared-module boundaries regardless of size, producing hundreds of tiny
 * chunk files. Rollup's manualChunks lets us inline modules that are only
 * used by one entry point and below a configurable byte threshold back into
 * their importer, matching the bundle shape users expect from webpack/vite.
 *
 * @param {number} [minChunkSize=4096] - Minimum byte size for a standalone chunk.
 *   Modules whose source is smaller than this threshold and are only imported
 *   by a single other module are merged back into that importer.
 * @returns {function} - manualChunks function to pass in Rollup output options
 */
function manualChunksPlugin(minChunkSize = 4096) {
  return function manualChunks(id, { getModuleInfo }) {
    const info = getModuleInfo(id);

    if (!info) return undefined;

    // Only collapse modules that are referenced by exactly one importer and
    // whose source code is below the threshold. Shared modules (importedBy > 1)
    // must stay as their own chunk so each importer gets a cache hit.
    if (
      info.importers &&
      info.importers.length === 1 &&
      info.code &&
      info.code.length < minChunkSize
    ) {
      // Return null to let Rollup inline it into the importer
      return null;
    }

    // Let Rollup use its default chunking for everything else
    return undefined;
  };
}

module.exports = manualChunksPlugin;

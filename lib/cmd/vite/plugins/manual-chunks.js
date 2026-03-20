'use strict';

const path = require('path');

/**
 * Vite/Rollup output.manualChunks factory for the Vite pipeline.
 *
 * Single-rule strategy
 * ─────────────────────────────────────────────────────────────────────────────
 * This function is applied only to the VIEW MODE build pass (bootstrap +
 * component client.js chunks). The kiln-edit-init entry is built separately
 * with inlineDynamicImports:true so its large model.js dependency tree never
 * pollutes the view-mode chunk graph.
 *
 * Rules (applied in order):
 *
 *   1. Skip static entries (bootstrap) and dynamic entries (client.js files) —
 *      these must always be their own chunks.
 *
 *   2. PRIVATE DEPS — exactly one static importer AND code < minChunkSize:
 *      Inline into the owning component chunk by walking the importer chain.
 *      These will never be shared, so bundling them with their owner is always
 *      correct and reduces the total file count without any cache tradeoff.
 *
 *   3. Everything else → let Rollup decide.
 *      Each shared dep gets its own chunk (Rollup's default). This avoids
 *      letter-bucket or vendor-bucket groupings that create circular chunk
 *      dependencies and cause "X is not a function" runtime errors when one
 *      bucket references another before it has finished initialising.
 *
 * @param {number} [minChunkSize=8192]  byte threshold; modules below this are
 *                                      candidates for private-dep inlining
 * @param {string} [cwd=process.cwd()]  root directory for relative chunk names
 * @returns {function} manualChunks function for rollupOptions.output.manualChunks
 */
function viteManualChunksPlugin(minChunkSize = 8192, cwd = process.cwd()) {
  return function manualChunks(id, { getModuleInfo }) {
    if (id.startsWith('\0')) return undefined;

    const info = getModuleInfo(id);

    if (!info) return undefined;

    // Rule 1: entries are always their own chunk
    if (info.isEntry || info.isDynamicEntry) return undefined;

    const importers = info.importers || [];
    const isSmall   = info.code != null && info.code.length < minChunkSize;

    // Rule 2: private dep (sole static importer, small) → inline into owner
    if (importers.length === 1 && isSmall) {
      const owner = findOwnerEntry(importers[0], getModuleInfo, new Set([id]));

      if (owner) return toChunkName(owner, cwd);
    }

    // Rule 3: let Rollup decide — each shared dep gets its own chunk.
    return undefined;
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Walk up the static importer chain until we reach the owning entry (static
 * or dynamic). Returns null if the chain splits (shared) or cycles.
 */
function findOwnerEntry(startId, getModuleInfo, visited) {
  if (visited.has(startId)) return null;
  visited.add(startId);

  if (startId.startsWith('\0')) return null;

  const info = getModuleInfo(startId);

  if (!info) return null;
  if (info.isEntry || info.isDynamicEntry) return startId;

  const importers = info.importers || [];

  if (importers.length !== 1) return null;

  return findOwnerEntry(importers[0], getModuleInfo, visited);
}


/**
 * Convert an absolute module ID to a safe relative chunk name string for use
 * as the [name] token in chunkFileNames (e.g. "chunks/[name]-[hash].js").
 */
function toChunkName(absoluteId, cwd) {
  return path.relative(cwd, absoluteId)
    .replace(/\.[^./\\]+$/, '')
    .replace(/\\/g, '/');
}

module.exports = viteManualChunksPlugin;

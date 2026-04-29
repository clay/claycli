'use strict';

const fs = require('fs');
const path = require('path');

const VIRTUAL_PREFIX = '\0clay-vite-missing:';

/**
 * Find the first existing file path among a list of candidates.
 * Returns undefined if none exist.
 *
 * @param {string} resolved  base resolved path (no extension)
 * @returns {string|undefined}
 */
function findExistingCandidate(resolved) {
  const candidates = [
    resolved,
    resolved + '.js',
    path.join(resolved, 'index.js'),
  ];

  return candidates.find(c => {
    try { return fs.statSync(c).isFile(); } catch (_) { return false; }
  });
}

/**
 * Returns true if a file is empty or unreadable.
 * Empty files should be stubbed: they produce MISSING_EXPORT warnings
 * from Rollup and an undefined default at runtime.
 *
 * @param {string} filepath
 * @returns {boolean}
 */
function isEmptyOrUnreadable(filepath) {
  try {
    return !fs.readFileSync(filepath, 'utf8').trim();
  } catch (_) {
    return true;
  }
}

/**
 * Vite plugin that silently stubs unresolvable relative imports.
 *
 * ── Why this exists ──────────────────────────────────────────────────────────
 *
 * The legacy Browserify pipeline ignored missing require() targets and produced
 * a bundle anyway (the missing module simply resolved to an empty object at
 * runtime).  Vite/Rollup errors hard on unresolvable imports by default.
 *
 * This plugin restores the lenient behaviour: if a relative import path does
 * not exist on disk, it is replaced with an empty ESM stub that exports
 * `undefined` as the default.  The browser simply receives `undefined` for
 * that import, which matches the historical Browserify behaviour.
 *
 * Never applies to node_modules imports — those must resolve correctly or fail
 * loudly to surface missing dependency installations.
 *
 * Runs with enforce:'pre' so it fires before Vite's resolver would hard-error.
 *
 * ── ESM migration note ───────────────────────────────────────────────────────
 *
 * This plugin exists because some legacy components import files that were
 * deleted or never created.  As components are migrated to ESM and cleaned up,
 * the number of stubs logged during the build should approach zero.  A zero
 * count means all imports are satisfied and this plugin becomes a no-op.
 */
/**
 * @returns {object} Vite plugin object
 */
function viteMissingModulePlugin() {
  return {
    name: 'clay-vite-missing-module',
    enforce: 'pre',

    resolveId(id, importer) {
      if (!importer) return null;
      if (!id.startsWith('.')) return null;

      // Strip Vite/Rollup internal query suffixes
      const cleanImporter = importer.replace(/\?.*$/, '').replace(/\0/g, '');

      if (!cleanImporter || !path.isAbsolute(cleanImporter)) return null;

      // Never touch node_modules imports
      if (cleanImporter.includes(`${path.sep}node_modules${path.sep}`)) return null;

      const resolved = path.resolve(path.dirname(cleanImporter), id);
      const existingFile = findExistingCandidate(resolved);

      if (!existingFile) {
        console.warn(
          `[clay vite] skipping missing module: ${id} ` +
          `(imported from ${path.relative(process.cwd(), cleanImporter)})`
        );
        return `${VIRTUAL_PREFIX}${id}`;
      }

      // Stub empty files too — see isEmptyOrUnreadable for rationale.
      if (isEmptyOrUnreadable(existingFile)) return `${VIRTUAL_PREFIX}${id}`;

      return null;
    },

    load(id) {
      if (id.startsWith(VIRTUAL_PREFIX)) {
        return 'export default undefined;';
      }

      return null;
    },
  };
}

module.exports = viteMissingModulePlugin;

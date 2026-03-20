'use strict';

const fs = require('fs');
const path = require('path');

const VIRTUAL_PREFIX = '\0clay-vite-missing:';

/**
 * Vite/Rollup plugin that silently stubs any relative import whose file does
 * not exist on disk, rather than hard-erroring.
 *
 * Vite/Rollup errors hard on unresolvable imports. This plugin restores the
 * lenient behaviour: missing project-source files are replaced with an empty
 * ESM stub so the build succeeds and the browser simply gets an undefined
 * default export. Never applies to node_modules paths.
 *
 * Runs with enforce:'pre' so it fires before Vite's resolver.
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
      const candidates = [
        resolved,
        resolved + '.js',
        path.join(resolved, 'index.js'),
      ];

      const existingFile = candidates.find(c => {
        try { return fs.statSync(c).isFile(); } catch (_) { return false; }
      });

      if (!existingFile) {
        console.warn(
          `[clay vite] skipping missing module: ${id} ` +
          `(imported from ${path.relative(process.cwd(), cleanImporter)})`
        );
        return `${VIRTUAL_PREFIX}${id}`;
      }

      // Stub empty files too — an empty file produces a MISSING_EXPORT warning
      // from Rollup and an undefined default at runtime.
      try {
        const content = fs.readFileSync(existingFile, 'utf8').trim();

        if (!content) return `${VIRTUAL_PREFIX}${id}`;
      } catch (_) {
        return `${VIRTUAL_PREFIX}${id}`;
      }

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

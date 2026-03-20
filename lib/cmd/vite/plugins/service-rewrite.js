'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Vite/Rollup plugin that rewrites imports of services/server/* to services/client/*.
 *
 * Runs with enforce:'pre' so it fires before Vite's resolver. Handles two
 * cases: explicit 'services/server' in the import string, and relative imports
 * whose resolved absolute path lands inside services/server/.
 */
function viteServiceRewritePlugin() {
  return {
    name: 'clay-vite-service-rewrite',
    enforce: 'pre',

    resolveId(id, importer) {
      // Case 1: the raw import string contains 'services/server'
      if (/services[/\\]server/.test(id)) {
        const clientPath = id.replace(/services[/\\]server/gi, 'services/client');
        const resolveDir = importer ? path.dirname(importer.replace(/\?.*$/, '')) : process.cwd();
        const candidates = [
          path.resolve(resolveDir, clientPath),
          path.resolve(resolveDir, `${clientPath}.js`),
          path.resolve(resolveDir, clientPath, 'index.js'),
        ];
        const resolved = candidates.find(c => fs.existsSync(c));

        if (!resolved) {
          this.error(
            'A server-side service must have a client-side counterpart.\n' +
            `Tried: ${candidates.join(', ')}`
          );
          return null;
        }

        return resolved;
      }

      // Case 2: relative import whose resolved path lands inside services/server/
      if (/[/\\]server[/\\]|^\.+[/\\]server[/\\]/.test(id) && importer) {
        const cleanImporter = importer.replace(/\?.*$/, '');
        const cwd = process.cwd();
        const resolved = path.resolve(path.dirname(cleanImporter), id);
        const rel = path.relative(cwd, resolved).replace(/\\/g, '/');

        if (!rel.startsWith('services/server/')) return null;

        const clientResolved = resolved.replace(
          /[/\\]services[/\\]server[/\\]/g,
          path.sep + 'services' + path.sep + 'client' + path.sep
        );
        const candidates = [
          clientResolved,
          clientResolved + '.js',
          path.join(clientResolved, 'index.js'),
        ];
        const found = candidates.find(c => fs.existsSync(c));

        if (found) return found;
      }

      return null;
    },
  };
}

module.exports = viteServiceRewritePlugin;

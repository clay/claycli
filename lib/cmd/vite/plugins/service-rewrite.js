'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Rollup plugin that rewrites imports of services/server/* to services/client/*.
 *
 * Mirrors lib/cmd/build/plugins/service-rewrite.js but uses Rollup's
 * resolveId hook instead of esbuild's onResolve hook.
 *
 * Two cases are handled:
 *
 *   Case 1 — explicit path (common): the import string itself contains
 *   'services/server'. Redirected before Rollup resolves the file.
 *
 *   Case 2 — relative cross-directory import: a file inside services/universal/
 *   uses a short relative path like require('../server/db') whose resolved
 *   absolute path lands inside services/server/. Detected by resolving to
 *   absolute and checking the path.
 */
function serviceRewritePlugin() {
  return {
    name: 'clay-service-rewrite',

    resolveId(id, importer) {
      // Case 1: the raw import string contains 'services/server'.
      if (/services[/\\]server/.test(id)) {
        const clientPath = id.replace(/services[/\\]server/gi, 'services/client');
        const resolveDir = importer ? path.dirname(importer) : process.cwd();
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

      // Case 2: relative imports whose raw path doesn't mention 'services/server'
      // but whose resolved absolute path lands inside services/server/.
      if (/[/\\]server[/\\]|^\.+[/\\]server[/\\]/.test(id) && importer) {
        const cwd = process.cwd();
        const resolved = path.resolve(path.dirname(importer), id);
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

module.exports = serviceRewritePlugin;

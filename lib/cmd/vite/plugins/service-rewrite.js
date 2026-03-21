'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Vite plugin that redirects imports of services/server/* to services/client/*.
 *
 * ── Why this exists ──────────────────────────────────────────────────────────
 *
 * Clay uses isomorphic service paths: a component imports
 * `../services/universal/auth` and the same import string resolves to different
 * implementations on the server vs the browser.  Server-only services live in
 * services/server/ and may import Node built-ins or database clients that must
 * never enter the browser bundle.  Every services/server/* file must have a
 * matching services/client/* counterpart that provides the browser-safe API.
 *
 * ── Bundle size impact if the pattern is not respected ───────────────────────
 *
 * services/server/* files typically pull in Node-only packages — database
 * clients, file system utilities, encryption libraries, server-side HTTP agents.
 * These packages have deep transitive dependency trees that are entirely dead
 * weight in the browser.  A single leaked server service can add hundreds of KB
 * to the bundle for code that will never execute.  Beyond size, many of these
 * packages reference Node built-ins that have no browser equivalent, causing
 * hard runtime errors the moment the module is evaluated.
 *
 * This plugin intercepts the import at resolution time — before the file is
 * read — and swaps the path.  It runs with enforce:'pre' so it fires before
 * Vite's resolver, which would otherwise try to resolve the server path and
 * error when it finds a file full of Node-only imports.
 *
 * Two cases are handled:
 *   1. The raw import string contains 'services/server' (explicit server import).
 *   2. A relative import resolves to an absolute path inside services/server/
 *      (e.g. `import './auth'` from inside services/server/).
 *
 * The plugin errors with a clear message if no client counterpart exists, rather
 * than silently stubbing the import, to surface missing client implementations
 * during development.
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

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
 *
 * ── serverOnlyPackages (separate, narrow, stopgap check) ────────────────────
 *
 * The services/server → services/client rewrite above only covers Clay's own
 * isomorphic service convention. It has no opinion on a THIRD-PARTY npm
 * package (Amphora, an Amphora plugin, etc.) that is itself server-only and
 * gets transitively pulled into a browser-reachable module graph — e.g. a
 * component's client.js imports something that requires 'amphora/lib/...'.
 *
 * Rather than hardcode any specific package name, sites opt in via a
 * `serverOnlyPackages` array of package-path prefixes, set from
 * `bundlerConfig()` in claycli.config.js — the same hook `nodeGlobals` uses
 * (see lib/cmd/vite/scripts.js getViteConfig() JSDoc), so all Vite-specific
 * config lives in one place:
 *
 *   bundlerConfig: config => {
 *     config.serverOnlyPackages = ['amphora/lib', 'amphora-html/lib'];
 *     return config;
 *   }
 *
 * Threaded in as a constructor argument (see viteServiceRewritePlugin below),
 * matching every other Vite plugin in this directory — none of them read
 * claycli.config.js themselves; buildPlugins() resolves config once and
 * passes it in.
 *
 * Defaults to [] — a complete no-op for every site that doesn't set it. This
 * is a WARN, not a block: an allowlist-style stopgap diagnostic, not a hard
 * guarantee like the services/server rewrite (which errors because a missing
 * client counterpart is unambiguously broken). A serverOnlyPackages match
 * just means "this looks suspicious" — the fix is a package `browser` field
 * remap or splitting out a browser-safe implementation, same as any other
 * leaked server dependency.
 */
/**
 * Does `id` match one of the configured serverOnlyPackages prefixes?
 *
 * A plain prefix match on path segments: 'amphora/lib' matches
 * 'amphora/lib/services/buffer' but not 'amphora/lib-other'.
 *
 * @param {string} id
 * @param {string[]} serverOnlyPackages
 * @returns {boolean}
 */
function matchesServerOnlyPackage(id, serverOnlyPackages) {
  return serverOnlyPackages.some(prefix => id === prefix || id.startsWith(`${prefix}/`));
}

/**
 * Separate, narrow check — see the serverOnlyPackages doc above. Warns only
 * (never blocks resolution); the caller always falls through to the
 * services/server rewrite logic afterward unchanged.
 *
 * @param {object} context  the Rollup plugin `this` (for `this.warn`)
 * @param {string} id
 * @param {string} [importer]
 * @param {string[]} serverOnlyPackages
 * @returns {void}
 */
function warnIfServerOnlyPackage(context, id, importer, serverOnlyPackages) {
  if (!serverOnlyPackages.length || !matchesServerOnlyPackage(id, serverOnlyPackages)) return;

  context.warn(
    `Module "${id}" (imported from "${importer || '(unknown)'}") matches a configured ` +
    'serverOnlyPackages prefix and looks like a server-only package being pulled into a ' +
    'browser-reachable bundle. Fix it with a package "browser" field remap or by splitting ' +
    'out a browser-safe implementation.'
  );
}

/**
 * @param {string[]} [serverOnlyPackages]  see the serverOnlyPackages doc
 *   above — resolved by the caller from bundlerConfig(), defaults to [].
 * @returns {object} Vite plugin object
 */
function viteServiceRewritePlugin(serverOnlyPackages = []) {
  return {
    name: 'clay-vite-service-rewrite',
    enforce: 'pre',

    resolveId(id, importer) {
      warnIfServerOnlyPackage(this, id, importer, serverOnlyPackages);

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

'use strict';

const fs = require('fs');
const path = require('path');

/**
 * esbuild plugin that rewrites imports of services/server/* to services/client/*.
 *
 * This matches the behavior of:
 *  - the Browserify `rewriteServiceRequire` transform in lib/cmd/compile/scripts.js
 *  - the Webpack `NormalModuleReplacementPlugin` in lib/cmd/pack/get-webpack-config.js
 *
 * Clay CMS services are written with dual server/client implementations. The server
 * path must never be bundled for the browser; this plugin redirects at resolve time.
 *
 * Two cases are handled:
 *
 *   Case 1 — explicit path (common): the import string itself contains
 *   'services/server', e.g. require('services/server/db') or
 *   require('../../../services/server/db').  The filter matches on the raw
 *   path string so the redirect fires before esbuild resolves the file.
 *
 *   Case 2 — relative cross-directory import: a file inside services/universal/
 *   uses a short relative path like require('../server/db') whose raw string
 *   is just '../server/db' — it doesn't contain 'services/server' — so Case 1
 *   misses it.  We resolve the path to absolute and check whether it falls
 *   inside services/server/ before rewriting.
 */
function serviceRewritePlugin() {
  return {
    name: 'clay-service-rewrite',
    setup(build) {

      // Case 1: the raw import string contains 'services/server'.
      build.onResolve({ filter: /services[/\\]server/ }, args => {
        const clientPath = args.path.replace(/services[/\\]server/gi, 'services/client');
        const candidates = [
          path.resolve(args.resolveDir, clientPath),
          path.resolve(args.resolveDir, `${clientPath}.js`),
          path.resolve(args.resolveDir, clientPath, 'index.js'),
        ];

        const resolved = candidates.find(c => fs.existsSync(c));

        if (!resolved) {
          return {
            errors: [{
              text:
                'A server-side service must have a client-side counterpart.\n' +
                `Tried: ${candidates.join(', ')}`
            }]
          };
        }

        return { path: resolved };
      });

      // Case 2: relative imports whose raw path doesn't mention 'services/server'
      // but whose resolved absolute path lands inside services/server/.
      // Example: require('../server/db') from services/universal/utils.js resolves
      // to <cwd>/services/server/db.js, which pulls in amphora-storage-postgres →
      // ioredis → pg — none of which can run in the browser.
      //
      // The filter /[/\\]server[/\\]|^\.+[/\\]server[/\\]/ is intentionally broad
      // so it fires on any import that mentions '/server/' or starts with a
      // relative path containing 'server/'.  The handler returns early if the
      // resolved absolute path does NOT fall under services/server/, so there
      // is no risk of misrouting unrelated imports like require('./server-utils').
      build.onResolve({ filter: /[/\\]server[/\\]|^\.+[/\\]server[/\\]/ }, args => {
        const cwd = process.cwd();
        const resolved = path.resolve(args.resolveDir, args.path);
        const rel = path.relative(cwd, resolved).replace(/\\/g, '/');

        if (!rel.startsWith('services/server/')) return;

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

        if (found) return { path: found };
      });
    }
  };
}

module.exports = serviceRewritePlugin;

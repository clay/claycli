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
 */
function serviceRewritePlugin() {
  return {
    name: 'clay-service-rewrite',
    setup(build) {
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
    }
  };
}

module.exports = serviceRewritePlugin;

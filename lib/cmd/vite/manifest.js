'use strict';

const fs = require('fs-extra');
const path = require('path');

/**
 * Writes a `_manifest.json` to the output directory.
 *
 * This produces the same JSON shape as lib/cmd/build/manifest.js (the esbuild
 * version) so that resolve-media.js and get-script-dependencies.js work
 * identically regardless of which bundler produced the output.
 *
 * Example output:
 * {
 *   "components/article/client": {
 *     "file": "/js/components/article/client-A1B2C3D4.js",
 *     "imports": ["/js/chunks/vendor-E5F6G7H8.js"]
 *   }
 * }
 *
 * @param {object} rollupBundle - The bundle object from Rollup's generateBundle hook
 * @param {string} outdir       - Absolute path to the output directory
 * @param {string} [publicBase] - URL prefix for all JS assets (default '/js')
 * @returns {Promise<object>}   - The manifest object written to disk
 */
async function writeManifest(rollupBundle, outdir, publicBase = '/js') {
  if (!rollupBundle) return;

  const manifest = {};

  for (const [fileName, chunk] of Object.entries(rollupBundle)) {
    if (chunk.type !== 'chunk') continue;
    if (!chunk.isEntry) continue;

    // Derive the stable manifest key from the entry file path.
    // facadeModuleId is the original source file's absolute path.
    const facadeId = chunk.facadeModuleId;

    if (!facadeId) continue;

    const entryKey = path.relative(process.cwd(), facadeId)
      .replace(/\\/g, '/')
      .replace(/\.js$/, '');

    const fileUrl = `${publicBase}/${fileName.replace(/\\/g, '/')}`;

    // Collect static imports (other chunks this chunk depends on).
    const importUrls = (chunk.imports || [])
      .map(imp => `${publicBase}/${imp.replace(/\\/g, '/')}`);

    manifest[entryKey] = {
      file: fileUrl,
      imports: importUrls,
    };
  }

  const manifestPath = path.join(outdir, '_manifest.json');

  await fs.outputJson(manifestPath, manifest, { spaces: 2 });

  return manifest;
}

/**
 * Rollup generateBundle plugin that writes _manifest.json.
 *
 * Used as a Rollup plugin in the watch context so the manifest is
 * regenerated on every rebuild. For the one-shot build path the
 * writeManifest() function is called directly.
 *
 * @param {string} outdir      - Absolute path to the output directory
 * @param {string} [publicBase] - URL prefix (default '/js')
 * @param {function} [onDone]  - Optional callback(manifest) after each write
 * @returns {object} - Rollup plugin
 */
function manifestPlugin(outdir, publicBase = '/js', onDone) {
  return {
    name: 'clay-manifest-writer',
    async generateBundle(_options, bundle) {
      const manifest = await writeManifest(bundle, outdir, publicBase);

      if (onDone) onDone(manifest);
    },
  };
}

module.exports = { writeManifest, manifestPlugin };

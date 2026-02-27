'use strict';

const fs = require('fs-extra');
const path = require('path');

/**
 * Writes a `_manifest.json` to the output directory.
 *
 * This replaces the Browserify `_registry.json` + `_ids.json` pair. Instead of
 * a graph of numeric module IDs, the manifest maps human-readable entry-point
 * names to their hashed output files and any shared chunks they import.
 *
 * Consuming Clay sites can use this manifest inside `resolveMedia` to determine
 * which `<script type="module">` tags to emit for each component, replacing the
 * `getDependencies()` + `window.require()` pattern entirely.
 *
 * Example output:
 * {
 *   "components/article/client": {
 *     "file": "/js/components/article/client-A1B2C3D4.js",
 *     "imports": ["/js/chunks/vendor-E5F6G7H8.js"]
 *   },
 *   "components/article/model": {
 *     "file": "/js/components/article/model-I9J0K1L2.js",
 *     "imports": []
 *   }
 * }
 *
 * @param {object} metafile - esbuild metafile (requires metafile: true)
 * @param {string} outdir  - absolute path to the output directory (e.g. <cwd>/public/js)
 * @param {string} publicBase - URL prefix for all JS assets (default '/js')
 */
async function writeManifest(metafile, outdir, publicBase = '/js') {
  if (!metafile || !metafile.outputs) return;

  const manifest = {};

  for (const [outputAbsPath, outputInfo] of Object.entries(metafile.outputs)) {
    const { entryPoint } = outputInfo;

    if (!entryPoint) continue; // skip chunks; they appear in `imports` lists

    // Derive a stable, human-readable key from the entry-point source path.
    // Strip the CWD prefix and the .js extension so consumers get something
    // like "components/article/client" or "layouts/default/model".
    const entryKey = entryPoint
      .replace(/^\.\//, '')
      .replace(/\.js$/, '');

    // Convert the absolute output path to a public URL.
    const fileUrl = toPublicUrl(outputAbsPath, outdir, publicBase);

    // Collect the public URLs for all direct chunk imports.
    const importUrls = (outputInfo.imports || [])
      .filter(i => i.kind === 'import-statement' || i.kind === 'dynamic-import')
      .map(i => toPublicUrl(i.path, outdir, publicBase));

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
 * Convert an absolute file path inside the output directory to a public URL.
 *
 * @param {string} absolutePath
 * @param {string} outdir
 * @param {string} publicBase
 * @returns {string}
 */
function toPublicUrl(absolutePath, outdir, publicBase) {
  const relative = path.relative(outdir, absolutePath);

  return `${publicBase}/${relative.replace(/\\/g, '/')}`;
}

module.exports = { writeManifest };

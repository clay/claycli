'use strict';

const fs = require('fs-extra');
const path = require('path');
const { globSync } = require('glob');
const { generateViteEnvInit } = require('./generate-env-init');

const CWD = process.cwd();
const CLAY_DIR = path.join(CWD, '.clay');
const KILN_EDIT_ENTRY_FILE = path.join(CLAY_DIR, 'vite-kiln-edit-init.js');
const KILN_EDIT_ENTRY_KEY = '.clay/vite-kiln-edit-init';

/**
 * Generate .clay/vite-kiln-edit-init.js — the Kiln edit-mode aggregator entry.
 *
 * Creates a single ESM entry that:
 *   1. Imports every component/layout model.js and registers it in
 *      window.kiln.componentModels so clay-kiln can find it.
 *   2. Does the same for kiln.js files → window.kiln.componentKilnjs.
 *   3. Imports services/kiln/index.js (if present) and calls it to run
 *      the site's kiln plugin initializer.
 *
 * This entry is included in the same splitting graph as vite-bootstrap.js.
 * Rollup's experimentalMinChunkSize merges individual model.js files (which
 * tend to be small) back into the kiln entry chunk, keeping the edit-mode
 * footprint compact without a separate inlineDynamicImports pass.
 *
 * @returns {Promise<string>} absolute path to the generated file
 */
async function generateViteKilnEditEntry() {
  await generateViteEnvInit();

  const modelFiles = [
    ...globSync(path.join(CWD, 'components', '**', 'model.js')),
    ...globSync(path.join(CWD, 'layouts', '**', 'model.js')),
  ];
  const kilnjsFiles = [
    ...globSync(path.join(CWD, 'components', '**', 'kiln.js')),
    ...globSync(path.join(CWD, 'layouts', '**', 'kiln.js')),
  ];
  const kilnPluginFile = path.join(CWD, 'services', 'kiln', 'index.js');
  const hasKilnPlugin = fs.existsSync(kilnPluginFile);

  const toRel = absPath => {
    const rel = path.relative(CLAY_DIR, absPath).replace(/\\/g, '/');

    return rel.startsWith('.') ? rel : `./${rel}`;
  };

  const lines = [
    '// AUTO-GENERATED — clay vite kiln edit aggregator (do not edit)',
    `// ${new Date().toISOString()}`,
    '',
  ];

  // Imports must appear first in an ES module.
  // Use namespace imports (import * as) so both CJS modules (which @rollup/plugin-commonjs
  // gives a namespace object with a .default property) and ESM modules work uniformly.
  // Then resolve the actual export via _resolveDefault() at runtime.
  lines.push('import \'./_env-init.js\';');
  modelFiles.forEach((f, i) => lines.push(`import * as _m${i} from ${JSON.stringify(toRel(f))};`));
  kilnjsFiles.forEach((f, i) => lines.push(`import * as _k${i} from ${JSON.stringify(toRel(f))};`));
  if (hasKilnPlugin) {
    lines.push(`import * as _kilnPluginNs from ${JSON.stringify(toRel(kilnPluginFile))};`);
  }

  // Helper that unwraps CJS default export from a namespace object.
  // CJS modules bundled by @rollup/plugin-commonjs expose their module.exports
  // as ns.default; pure ESM modules that use "export default" also have ns.default.
  // If neither is present, fall back to the namespace itself.
  lines.push('');
  lines.push('function _resolveDefault(ns) { return (ns && ns.default !== undefined) ? ns.default : ns; }');

  lines.push('');
  lines.push('window.kiln = window.kiln || {};');
  lines.push('window.modules = window.modules || {};');

  // Register models
  lines.push('window.kiln.componentModels = window.kiln.componentModels || {};');
  modelFiles.forEach((f, i) => {
    const name = path.basename(path.dirname(f));

    lines.push(`window.kiln.componentModels[${JSON.stringify(name)}] = _resolveDefault(_m${i});`);
  });

  // Register kiln.js plugins
  lines.push('window.kiln.componentKilnjs = window.kiln.componentKilnjs || {};');
  kilnjsFiles.forEach((f, i) => {
    const name = path.basename(path.dirname(f));

    lines.push(`window.kiln.componentKilnjs[${JSON.stringify(name)}] = _resolveDefault(_k${i});`);
  });

  // Run site kiln plugin initializer
  if (hasKilnPlugin) {
    lines.push('var _initKilnPlugins = _resolveDefault(_kilnPluginNs);');
    lines.push('if (typeof _initKilnPlugins === "function") _initKilnPlugins();');
  }

  await fs.ensureDir(CLAY_DIR);
  await fs.writeFile(KILN_EDIT_ENTRY_FILE, lines.join('\n'), 'utf8');

  return KILN_EDIT_ENTRY_FILE;
}

module.exports = {
  generateViteKilnEditEntry,
  KILN_EDIT_ENTRY_FILE,
  KILN_EDIT_ENTRY_KEY,
};

'use strict';

const fs = require('fs-extra');
const path = require('path');
const { globSync } = require('glob');

const CWD = process.cwd();
const CLAY_DIR = path.join(CWD, '.clay');
const GLOBALS_INIT_FILE = path.join(CLAY_DIR, '_globals-init.js');

/**
 * Generate .clay/_globals-init.js — imports every global/js/*.js file into
 * a single non-splitting bundle entry.
 *
 * Built with experimentalMinChunkSize very high (or inlined as one file) so
 * the browser loads one file instead of many tiny shared chunks that Rollup
 * would otherwise produce from the overlapping global scripts.
 *
 * @returns {Promise<string|null>} path to the generated file, or null if
 *   no global/js/*.js files exist in this project
 */
async function generateViteGlobalsInit() {
  // Sorted: glob 10 returns directory-read order, which differs between
  // filesystems, and this import order is the order the global scripts run.
  const globalFiles = globSync(path.join(CWD, 'global', 'js', '*.js'))
    .filter(f => !path.basename(f).includes('.test.'))
    .sort();

  if (globalFiles.length === 0) return null;

  const lines = [
    // No build timestamp: this text is embedded in the source map.
    '// AUTO-GENERATED — clay vite globals init (do not edit)',
    '// Bundles all global/js/*.js scripts into a single non-splitting entry.',
    '',
  ];

  for (const f of globalFiles) {
    const rel = path.relative(CLAY_DIR, f).replace(/\\/g, '/');

    lines.push(`import './${rel}';`);
  }

  await fs.ensureDir(CLAY_DIR);
  await fs.writeFile(GLOBALS_INIT_FILE, lines.join('\n'), 'utf8');

  return GLOBALS_INIT_FILE;
}

module.exports = {
  generateViteGlobalsInit,
  GLOBALS_INIT_FILE,
};

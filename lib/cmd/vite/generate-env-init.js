'use strict';

const fs = require('fs-extra');
const path = require('path');

const CWD = process.cwd();
const CLAY_DIR = path.join(CWD, '.clay');
const ENV_INIT_FILE = path.join(CLAY_DIR, '_env-init.js');

/**
 * Generate .clay/_env-init.js — runtime hydration for window.process.env.
 *
 * Why:
 * - Universal modules can be evaluated before late env injection in some
 *   browser paths under ESM (especially edit-mode/kiln startup), and any
 *   top-level `const X = process.env.X` captures undefined permanently.
 * - Hydrating window.process.env in a dedicated side-effect module imported
 *   first by Vite entries ensures env is present before those modules run.
 *
 * Sources (in priority order):
 * 1) window.kiln.preloadData._envVars (authoritative edit-mode payload from amphora-html)
 * 2) existing window.process.env (if already injected by any earlier script)
 *
 * @returns {Promise<string>} absolute path to the generated file
 */
async function generateViteEnvInit() {
  const content = [
    '// AUTO-GENERATED — clay vite env init (do not edit)',
    `// ${new Date().toISOString()}`,
    ';(function clayViteEnvInit() {',
    '  if (typeof window === "undefined") return;',
    '',
    '  var fromKiln = window.kiln && window.kiln.preloadData && window.kiln.preloadData._envVars;',
    '  var existing = window.process && window.process.env;',
    '',
    '  var source = (fromKiln && typeof fromKiln === "object")',
    '    ? fromKiln',
    '    : ((existing && typeof existing === "object") ? existing : {});',
    '',
    '  window.process = window.process || {};',
    '  window.process.env = Object.assign({}, source, window.process.env || {});',
    '}());',
    '',
  ].join('\n');

  await fs.ensureDir(CLAY_DIR);
  await fs.writeFile(ENV_INIT_FILE, content, 'utf8');

  return ENV_INIT_FILE;
}

module.exports = {
  generateViteEnvInit,
  ENV_INIT_FILE,
};


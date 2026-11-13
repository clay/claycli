/* eslint-env jest */
'use strict';

/**
 * Output-level checks for CommonJS conversion in `clay vite`.
 *
 * These run claycli's real buildJS() (both passes, unmocked) over a tiny site
 * whose CommonJS module has the shape that broke Kiln edit mode: an `if` test
 * that claycli's `process.browser` define turns into `<unknown> || false`,
 * with `exports` writes in both branches.  Vite's bundled
 * @rollup/plugin-commonjs (26.x in Vite 5, 29.0.x in Vite 7) never rewrote the
 * `if` branch, leaving a free `exports` that throws in the browser.  Each graph also has an `import()`,
 * which is what kept esbuild from hiding that leak in its CommonJS wrapper.
 * See buildCommonjsPlugin() in scripts.js and plugins/free-cjs-refs.js.
 */

const { execFileSync } = require('child_process');
const fs = require('fs-extra');
const { globSync } = require('glob');
const os = require('os');
const path = require('path');
const { findFreeCommonjsRefs } = require('./plugins/free-cjs-refs');

let tmpDir;

/**
 * Build script run in a child Node process: Vite is ESM-only, which Jest's
 * module VM refuses to load without --experimental-vm-modules (see base.test.js).
 *
 * Modes:
 *   default                → claycli's real buildJS()
 *   vite-bundled-commonjs  → the same, but with Vite's bundled commonjs put
 *                            back in place of claycli's (the setup before
 *                            this fix), to prove the fixture reproduces the bug
 */
const RUNNER = `
'use strict';
const [dir, mode, scriptsPath] = process.argv.slice(2);

// scripts.js resolves the site root from process.cwd() at load time.
process.chdir(dir);

if (mode === 'vite-bundled-commonjs') {
  // Vite 7's exports are an immutable ESM namespace, so hand scripts.js a copy
  // of it whose build() swaps the config.
  const Module = require('module');
  const load = Module.prototype.require;

  Module.prototype.require = function (id) {
    const vite = load.apply(this, arguments);

    if (id !== 'vite') return vite;

    return {
      ...vite,
      build: cfg => {
        cfg.build.commonjsOptions = {
          include: /\\.(js|cjs|vue)$/,
          extensions: ['.js', '.cjs', '.vue'],
          transformMixedEsModules: true,
          requireReturnsDefault: 'preferred',
          strictRequires: 'auto',
        };
        cfg.build.rollupOptions.plugins = [];
        return vite.build(cfg);
      },
    };
  };
}

require(scriptsPath).buildJS().catch(err => {
  console.error(err.message);
  process.exit(1);
});
`;

const FIXTURE = {
  // Same shape as randomfill/browser.js.  `x` is unknown at build time;
  // `!process.browser` is folded to `false` by claycli's define.
  'lib/feature-flag.js': [
    '\'use strict\';',
    'var x = globalThis.featureFlags;',
    '',
    'if (x && x.y || !process.browser) {',
    '  exports.a = 1;',
    '} else {',
    '  exports.a = 2;',
    '}',
    '',
  ].join('\n'),
  'lib/lazy.js': 'export default \'lazy\';\n',
  // View pass: component client.js (CommonJS) with an import().
  'components/widget/client.js': [
    '\'use strict\';',
    'var flag = require(\'../../lib/feature-flag\');',
    '',
    'module.exports = function (el) {',
    '  el.dataset.flag = flag.a;',
    '  return import(\'../../lib/lazy.js\');',
    '};',
    '',
  ].join('\n'),
  // Kiln pass: model.js plus a Kiln plugin entry with an import().
  'components/widget/model.js': [
    '\'use strict\';',
    'var flag = require(\'../../lib/feature-flag\');',
    '',
    'module.exports.save = function (uri, data) {',
    '  data.flag = flag.a;',
    '  return data;',
    '};',
    '',
  ].join('\n'),
  'services/kiln/index.js': [
    '\'use strict\';',
    'module.exports = function () {',
    '  window.kiln.plugins.lazy = function () { return import(\'../../lib/lazy.js\'); };',
    '};',
    '',
  ].join('\n'),
};

/**
 * Write the fixture site and run buildJS() over it in a child process.
 *
 * @param {string} mode  'default' | 'vite-bundled-commonjs'
 * @returns {{ status: number, output: string }}
 */
function build(mode) {
  const runner = path.join(tmpDir, 'run-build.js');

  for (const [file, code] of Object.entries(FIXTURE)) {
    fs.outputFileSync(path.join(tmpDir, file), code);
  }
  fs.writeFileSync(runner, RUNNER);

  try {
    const output = execFileSync(process.execPath, [
      runner,
      tmpDir,
      mode,
      require.resolve('./scripts'),
    ], { encoding: 'utf8', stdio: 'pipe' });

    return { status: 0, output };
  } catch (err) {
    return { status: err.status, output: `${err.stdout}${err.stderr}` };
  }
}

/**
 * Every emitted .js file under public/js, as { file, code }.
 *
 * @returns {Array<{file: string, code: string}>}
 */
function outputChunks() {
  const root = path.join(tmpDir, 'public', 'js');

  return globSync('**/*.js', { cwd: root, dot: true })
    .map(file => ({ file: file.replace(/\\/g, '/'), code: fs.readFileSync(path.join(root, file), 'utf8') }));
}

describe('vite commonjs conversion (real build)', () => {
  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'claycli-vite-commonjs-'));
  });

  afterEach(async () => {
    await fs.remove(tmpDir);
  });

  it('converts exports in a branch whose test folds to `|| false`, in both passes', () => {
    const { status, output } = build('default');

    expect({ status, output }).toMatchObject({ status: 0 });

    const chunks = outputChunks();
    const kiln = chunks.find(c => c.file.startsWith('.clay/vite-kiln-edit-init-'));
    const withFlag = chunks.filter(c => /\.a = 1;/.test(c.code));

    // Nothing in the output references a CommonJS global it doesn't define.
    chunks.forEach(c => expect({ file: c.file, refs: findFreeCommonjsRefs(c.code) }).toEqual({ file: c.file, refs: [] }));

    // The kiln bundle has ESM syntax (from the inlined import()), so esbuild
    // never wrapped it: a leaked `exports` would be a live global reference.
    expect(kiln.code).toContain('import.meta');

    // Both passes contain the module, and both branches write to the same
    // converted exports object.
    expect(withFlag.map(c => c.file)).toEqual(expect.arrayContaining([kiln.file, expect.stringMatching(/^chunks\//)]));
    withFlag.forEach(({ code }) => {
      const [, ifTarget, elseTarget] = code.match(/(\w+)\.a = 1;\s*\}\s*else\s*\{\s*(\w+)\.a = 2;/);

      expect(ifTarget).not.toBe('exports');
      expect(ifTarget).toBe(elseTarget);
    });
  });

  // Canary: if a Vite upgrade fixes its bundled commonjs, this fails, and
  // buildCommonjsPlugin() may no longer be needed.
  it('fails the build, naming the module, with Vite\'s bundled commonjs', () => {
    const { status, output } = build('vite-bundled-commonjs');

    expect(status).not.toBe(0);
    expect(output).toContain('references CommonJS exports without defining it');
    expect(output).toMatch(/`exports` at \d+:\d+ in lib\/feature-flag\.js/);
  });
});

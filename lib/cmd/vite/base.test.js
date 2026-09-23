/* eslint-env jest */
'use strict';

/**
 * Output-level checks for the Vite `base` claycli builds with.
 *
 * These run a real (unmocked) Vite build of a tiny fixture laid out like
 * claycli's output — an entry in `.clay/` that dynamically imports two
 * component chunks sharing a dependency in `chunks/` — and assert on the
 * preload URLs Vite actually writes. They guard the behavior rather than the
 * config value, so a Vite upgrade that changes how the preload helper builds
 * URLs fails here instead of silently reintroducing the double download.
 */

const { execFileSync } = require('child_process');
const fs = require('fs-extra');
const os = require('os');
const path = require('path');

let tmpDir;

/**
 * Build script run in a child Node process. Vite's CommonJS entry loads its
 * ESM build through a dynamic import(), which Jest's module VM refuses without
 * --experimental-vm-modules, so the real build happens outside Jest.
 *
 * It writes the fixture (an entry with two dynamic imports whose chunks share
 * one module, so Vite emits a preload dep list), builds it with the output
 * layout and modulePreload setting claycli uses, and prints the entry chunk.
 *
 * Modes:
 *   default     → resolveViteBase({})
 *   site-plugin → default base + a site plugin setting experimental.renderBuiltUrl
 *   public-base → resolveViteBase({ publicBase: '/js' })
 */
const RUNNER = `
'use strict';
const fs = require('fs');
const path = require('path');
const [dir, mode, vitePath, scriptsPath] = process.argv.slice(2);
const vite = require(vitePath);
const { resolveViteBase } = require(scriptsPath);

fs.writeFileSync(path.join(dir, 'shared.js'), 'export const shared = () => "shared";\\n');
fs.writeFileSync(path.join(dir, 'a.js'), 'import { shared } from "./shared.js";\\nexport default () => shared() + "a";\\n');
fs.writeFileSync(path.join(dir, 'b.js'), 'import { shared } from "./shared.js";\\nexport default () => shared() + "b";\\n');
// A side effect, like the real bootstrap: Vite drops entry exports in app
// builds, so an exported loader would be tree-shaken away with its imports.
fs.writeFileSync(path.join(dir, 'entry.js'), 'globalThis.load = () => [import("./a.js"), import("./b.js")];\\n');

// The stopgap shape nymag/sites shipped before this landed in claycli.
const sitePlugin = {
  name: 'site-relative-preload-urls',
  config: () => ({
    experimental: {
      renderBuiltUrl: (filename, { hostType }) => hostType === 'js' ? { relative: true } : undefined,
    },
  }),
};

vite.build({
  root: dir,
  base: resolveViteBase(mode === 'public-base' ? { publicBase: '/js' } : {}),
  configFile: false,
  logLevel: 'silent',
  plugins: mode === 'site-plugin' ? [sitePlugin] : [],
  build: {
    write: false,
    minify: false,
    modulePreload: { polyfill: false },
    rollupOptions: {
      input: { entry: path.join(dir, 'entry.js') },
      output: {
        entryFileNames: '.clay/[name]-[hash].js',
        chunkFileNames: 'chunks/[name]-[hash].js',
      },
    },
  },
}).then(result => {
  const output = (Array.isArray(result) ? result[0] : result).output;

  process.stdout.write(output.find(chunk => chunk.isEntry).code);
}).catch(err => {
  console.error(err);
  process.exit(1);
});
`;

/**
 * Build the fixture in a child process and return the `.clay/` entry chunk.
 *
 * @param {string} mode  'default' | 'site-plugin' | 'public-base'
 * @returns {string} entry chunk code
 */
function buildEntry(mode) {
  const runner = path.join(tmpDir, 'run-build.js');

  fs.writeFileSync(runner, RUNNER);
  return execFileSync(process.execPath, [
    runner,
    tmpDir,
    mode,
    require.resolve('vite'),
    require.resolve('./scripts'),
  ], { encoding: 'utf8' });
}

/**
 * Pull the preload dep list out of Vite's `__vite__mapDeps` table.
 *
 * @param {string} code
 * @returns {string[]}
 */
function preloadDeps(code) {
  const match = code.match(/m\.f=(\[[^\]]*\])/);

  return match ? JSON.parse(match[1]) : [];
}

describe('vite base (real build)', () => {
  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'claycli-vite-base-'));
  });

  afterEach(async () => {
    await fs.remove(tmpDir);
  });

  it('default relative base resolves preload deps against the importing chunk', () => {
    const code = buildEntry('default');
    const deps = preloadDeps(code);

    expect(code).toMatch(/new URL\(dep, importerUrl\)/);
    expect(deps.length).toBeGreaterThan(0);
    // Relative to .clay/ → <wherever the bootstrap loaded>/chunks/…
    deps.forEach(dep => expect(dep).toMatch(/^\.\.\/chunks\//));
    expect(code).not.toContain('"/js/"');
  });

  it('a site plugin setting experimental.renderBuiltUrl still produces relative preloads', () => {
    // The stopgap nymag/sites shipped must keep working on top of the default.
    const code = buildEntry('site-plugin');

    expect(code).toMatch(/new URL\(dep, importerUrl\)/);
    preloadDeps(code).forEach(dep => expect(dep).toMatch(/^\.\.\/chunks\//));
  });

  it('an explicit publicBase opts back into an absolute base', () => {
    const code = buildEntry('public-base');

    expect(code).toMatch(/return "\/js\/" \+ dep/);
    preloadDeps(code).forEach(dep => expect(dep).toMatch(/^chunks\//));
  });
});

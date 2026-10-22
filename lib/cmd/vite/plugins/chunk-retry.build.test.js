/* eslint-env jest */
'use strict';

/**
 * Output-level checks for the chunk-retry plugin against a real Vite build.
 *
 * The unit tests run the injected runtime against a stand-in for Vite's preload
 * helper.  These build a tiny fixture with the real Vite, laid out like
 * claycli's output (a `.clay/` entry dynamically importing three component
 * chunks, two sharing a dependency and one with none), and assert on what Vite
 * actually writes, so a Vite upgrade that changes the helper's shape or how
 * dependency lists are built fails here instead of silently shipping unwrapped.
 */

const { execFileSync } = require('child_process');
const fs = require('fs-extra');
const os = require('os');
const path = require('path');

let tmpDir;

/**
 * Build script run in a child Node process (Vite's CommonJS entry cannot load
 * its ESM build inside Jest's module VM).  Prints the `.clay/` entry chunk.
 */
const RUNNER = `
'use strict';
const fs = require('fs');
const path = require('path');
const [dir, mode, vitePath, pluginPath] = process.argv.slice(2);
const vite = require(vitePath);
const chunkRetry = require(pluginPath);

fs.writeFileSync(path.join(dir, 'shared.js'), 'export const shared = () => "shared";\\n');
fs.writeFileSync(path.join(dir, 'a.js'), 'import { shared } from "./shared.js";\\nexport default () => shared() + "a";\\n');
fs.writeFileSync(path.join(dir, 'b.js'), 'import { shared } from "./shared.js";\\nexport default () => shared() + "b";\\n');
fs.writeFileSync(path.join(dir, 'c.js'), 'export default () => "c";\\n');
fs.writeFileSync(path.join(dir, 'entry.js'), 'globalThis.load = () => [import("./a.js"), import("./b.js"), import("./c.js")];\\n');

const modulePreload = mode === 'preload-off' ? false : { polyfill: false };

vite.build({
  root: dir,
  base: './',
  configFile: false,
  logLevel: 'silent',
  plugins: mode === 'plain' ? [] : [chunkRetry({ attempts: 4, delay: 120 })],
  build: {
    write: false,
    minify: false,
    cssCodeSplit: false,
    modulePreload,
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
 * Build the fixture in a child process and return the entry chunk.
 *
 * @param {string} mode  'retry' | 'plain' | 'preload-off'
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
    require.resolve('./chunk-retry'),
  ], { encoding: 'utf8' });
}

/**
 * Parse each `__vitePreload(() => import("./chunks/x.js"), deps)` call site
 * into the chunk it loads and the dependency files Vite passed with it.
 *
 * @param {string} code
 * @returns {Object<string, string[]>}  chunk basename (without hash) -> dep basenames
 */
function callSites(code) {
  const table = JSON.parse(code.match(/m\.f=(\[[^\]]*\])/)[1]);
  const sites = {};
  const re = /__vitePreload\(\(\) => import\("\.{1,2}\/chunks\/([a-z]+)-[^"]+\.js"\), true \? (__vite__mapDeps\(\[([^\]]*)\]\)|\[\]) : void 0/g;

  let m;

  while (m = re.exec(code)) {
    const indexes = m[3] ? m[3].split(',').map(Number) : [];

    sites[m[1]] = indexes.map(i => path.basename(table[i]).replace(/-[^-]+\.js$/, ''));
  }

  return sites;
}

describe('chunk-retry plugin (real vite build)', () => {
  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'claycli-chunk-retry-'));
  });

  afterEach(async () => {
    await fs.remove(tmpDir);
  });

  it('wraps Vite’s preload helper and routes every dynamic import through the wrapper', () => {
    const code = buildEntry('retry');

    expect(code).toContain('const __clayOriginalPreload = function preload(');
    expect(code).toContain('const __vitePreload = function preloadWithRetry(');
    // esbuild reformats the JSON options as an object literal
    expect(code).toMatch(/var __clayRetry = \{\s*"attempts": 4,\s*"delay": 120,\s*"timeout": 1e4,\s*"maxWait": 2e3\s*\};/);
    // the helper's own state is still in scope for the wrapper
    expect(code).toContain('const assetsURL = function(dep, importerUrl)');
    expect(Object.keys(callSites(code)).sort()).toEqual(['a', 'b', 'c']);
  });

  it('gives every dynamic import a non-empty dependency list, including a chunk with no dependencies', () => {
    const sites = callSites(buildEntry('retry'));

    expect(sites.a).toEqual(['a', 'shared']);
    expect(sites.b).toEqual(['b', 'shared']);
    // Vite alone passes [] for this one; the plugin asks for the chunk itself
    expect(sites.c).toEqual(['c']);
  });

  it('leaves the single-file chunk without dependencies when the plugin is not used', () => {
    const code = buildEntry('plain');

    expect(code).not.toContain('__clayOriginalPreload');
    expect(callSites(code).c).toEqual([]);
  });

  it('does nothing when module preloading is switched off', () => {
    const code = buildEntry('preload-off');

    expect(code).not.toContain('__clayOriginalPreload');
    expect(code).not.toContain('securitypolicyviolation');
  });
});

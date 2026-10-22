/* eslint-env jest */
'use strict';

/**
 * `clay vite` output must not depend on the order the build's async work
 * finishes in.  Content hashes are in every chunk's name and in its
 * importers' import specifiers, so a file that changes from build to build
 * renames every chunk above it and costs readers their cached copies.
 *
 * This runs claycli's real buildJS() over a small site twice, with a site
 * plugin that holds back loading either the "early" or the "late" files until
 * the other side is parsed, so module transforms (including the two Kiln
 * panels' async PostCSS runs) finish in opposite orders.  The output must be
 * byte-identical.
 *
 * Known exception, deliberately not in this fixture: a CommonJS module that
 * is required both conditionally (inside a function or branch) and
 * unconditionally.  @rollup/plugin-commonjs's strictRequires:'auto' decides
 * whether to wrap it from load order, so it can differ between builds.  See
 * CLAY-VITE.md § "Build output stability".
 */

const { execFileSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs-extra');
const { globSync } = require('glob');
const os = require('os');
const path = require('path');

let tmpDir;

const RUNNER = `
'use strict';
const [dir, scriptsPath] = process.argv.slice(2);

// scripts.js resolves the site root from process.cwd() at load time.
process.chdir(dir);
require(scriptsPath).buildJS().catch(err => {
  console.error(err.stack || err.message);
  process.exit(1);
});
`;

const CONFIG = `
'use strict';
// Test-only: hold back loading each file under /<DELAY>/ until its
// counterpart on the other side (early <-> late swapped) has been parsed.
// An ordering barrier rather than a timer, so the order holds on a slow or
// loaded machine.
const parsed = new Map();
const whenParsed = id => {
  if (!parsed.has(id)) {
    let resolve;
    const promise = new Promise(r => { resolve = r; });

    parsed.set(id, { promise, resolve });
  }
  return parsed.get(id);
};

module.exports = {
  bundlerConfig: config => {
    const held = process.env.DELAY;
    const other = held === 'early' ? 'late' : 'early';

    config.plugins = (config.plugins || []).concat({
      name: 'test-delay',
      enforce: 'pre',
      async load(id) {
        if (held && id.includes('/' + held + '/')) {
          await whenParsed(id.replace('/' + held + '/', '/' + other + '/')).promise;
        }
        return null;
      },
      moduleParsed(info) {
        whenParsed(info.id).resolve();
      },
    });
    return config;
  },
};
`;

const component = name => [
  '\'use strict\';',
  'var shared = require(\'../../lib/shared\');',
  '',
  'module.exports = function (el) {',
  `  el.dataset.${name} = shared.n;`,
  '};',
  '',
].join('\n');

const panel = name => [
  `<template><div class="${name}">${name}</div></template>`,
  `<script>module.exports = { name: '${name}' };</script>`,
  `<style>.${name} { color: red; }</style>`,
  '',
].join('\n');

const FIXTURE = {
  'claycli.config.js': CONFIG,
  'lib/shared.js': '\'use strict\';\nmodule.exports = { n: 1 };\n',
  'global/js/a.js': 'window.a = 1;\n',
  'global/js/b.js': 'window.b = 2;\n',
  // View pass: both client.js files are dynamic imports of the bootstrap.
  'components/early/client.js': component('early'),
  'components/late/client.js': component('late'),
  // Kiln pass: model.js files plus a Kiln plugin entry with two styled panels.
  'components/early/model.js': component('early'),
  'components/late/model.js': component('late'),
  'services/kiln/index.js': [
    '\'use strict\';',
    'var early = require(\'./early/panel.vue\');',
    'var late = require(\'./late/panel.vue\');',
    '',
    'module.exports = function () {',
    '  window.kiln.plugins.panels = [early, late];',
    '};',
    '',
  ].join('\n'),
  'services/kiln/early/panel.vue': panel('early'),
  'services/kiln/late/panel.vue': panel('late'),
};

/**
 * Write the fixture into a fresh directory and run buildJS() over it in a
 * child process (Vite's CommonJS entry loads its ESM build through a dynamic
 * import(), which Jest's module VM refuses).
 *
 * @param {string} name   subdirectory of tmpDir
 * @param {string} delay  'early' | 'late': which side loads last
 * @returns {{ status: number, output: string, dir: string }}
 */
function build(name, delay) {
  const dir = path.join(tmpDir, name);
  const runner = path.join(tmpDir, 'run-build.js');

  for (const [file, code] of Object.entries(FIXTURE)) {
    fs.outputFileSync(path.join(dir, file), code);
  }
  fs.writeFileSync(runner, RUNNER);

  try {
    const output = execFileSync(process.execPath, [runner, dir, require.resolve('./scripts')], {
      encoding: 'utf8',
      stdio: 'pipe',
      env: { ...process.env, DELAY: delay },
    });

    return { status: 0, output, dir };
  } catch (err) {
    return { status: err.status, output: `${err.stdout}${err.stderr}`, dir };
  }
}

/**
 * Every file the build wrote under public/, as path → sha1.
 *
 * @param {string} dir  site root
 * @returns {object}
 */
function outputTree(dir) {
  const root = path.join(dir, 'public');

  return Object.fromEntries(globSync('**/*', { cwd: root, dot: true, nodir: true }).sort().map(file => [
    file.replace(/\\/g, '/'),
    crypto.createHash('sha1').update(fs.readFileSync(path.join(root, file))).digest('hex'),
  ]));
}

describe('vite build output stability (real build)', () => {
  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'claycli-vite-stability-'));
  });

  afterAll(async () => {
    await fs.remove(tmpDir);
  });

  it('emits identical output whichever order the transforms finish in', () => {
    const lateLast = build('late-last', 'late');
    const earlyLast = build('early-last', 'early');

    expect({ status: lateLast.status, output: lateLast.output }).toMatchObject({ status: 0 });
    expect({ status: earlyLast.status, output: earlyLast.output }).toMatchObject({ status: 0 });

    const tree = outputTree(lateLast.dir);

    expect(Object.keys(tree)).toEqual(expect.arrayContaining(['css/_kiln-plugins.css', 'js/_manifest.json']));
    expect(outputTree(earlyLast.dir)).toEqual(tree);
    expect(fs.readFileSync(path.join(lateLast.dir, 'public', 'css', '_kiln-plugins.css'), 'utf8'))
      .toBe('.early { color: red; }\n.late { color: red; }');
  });
});

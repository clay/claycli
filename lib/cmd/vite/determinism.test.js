/* eslint-env jest */
'use strict';

/**
 * `clay vite` must emit the same bytes for the same source, however the
 * build's async work happens to interleave.  Content hashes are in every
 * chunk's name and in its importers' import specifiers, so one leaf that
 * changes from build to build renames every chunk above it and throws away
 * the browser cache for them on each deploy.
 *
 * This runs claycli's real buildJS() over a small site twice, with a site
 * plugin that holds back loading either the "early" or the "late" files until
 * the other side is parsed.  That forces each order of the two races claycli
 * has to neutralize:
 *
 *   - lib/shared.js is required conditionally (inside a function) by the
 *     early files and unconditionally by the late ones.  commonjs's
 *     strictRequires:'auto' wraps it in a lazy requireShared() when only the
 *     conditional require has been seen by the time shared.js is transformed,
 *     and hoists it otherwise (see plugins/strict-requires.js).
 *   - Two Kiln .vue files with <style> blocks finish their PostCSS transform
 *     in either order (see kilnCssContent() in plugins/vue2.js).
 *
 * The 'no-check' canary turns claycli's wrapping check off, to prove the
 * fixture really reproduces the race: without the fix the two orders give
 * different bundles.
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
const [dir, mode, strictRequiresPath, scriptsPath] = process.argv.slice(2);

// scripts.js resolves the site root from process.cwd() at load time.
process.chdir(dir);

if (mode === 'no-check') {
  // scripts.js destructures this at load time, so patch it first.
  require(strictRequiresPath).createStrictRequiresCheck = () => ({ name: 'no-check' });
}

require(scriptsPath).buildJS().catch(err => {
  console.error(err.stack || err.message);
  process.exit(1);
});
`;

const CONFIG = `
'use strict';
// Test-only: hold back loading each file under /<DELAY>/ until its
// counterpart on the other side (same path with early <-> late swapped) has
// been parsed, i.e. commonjs has registered all of that file's requires.  An
// ordering barrier rather than a timer, so the race goes the same way on a
// slow or loaded machine.
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

// The conditional side also requires a conditional-only module, and the
// unconditional side a require() cycle, so the explicit list a rebuilt pass
// gets is not empty: lazy-only.js, cycle-a.js and cycle-b.js are wrapped
// either way.
const conditional = rel => [
  '\'use strict\';',
  'module.exports = function (el) {',
  `  el.dataset.n = require('${rel}/shared').n;`,
  `  el.dataset.lazy = require('${rel}/lazy-only').lazy;`,
  '};',
  '',
].join('\n');

const unconditional = rel => [
  '\'use strict\';',
  `var shared = require('${rel}/shared');`,
  `var cycle = require('${rel}/cycle-a');`,
  '',
  'module.exports = function (el) {',
  '  el.dataset.n = shared.n + cycle.a();',
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
  'lib/shared.js': [
    '\'use strict\';',
    // A NODE_ENV switch: a rebuilt pass must pick the same side as the first
    // attempt, even though Vite sets NODE_ENV once its first build starts.
    'module.exports = process.env.NODE_ENV === \'production\' ? require(\'./prod\') : require(\'./dev\');',
    '',
  ].join('\n'),
  'lib/dev.js': '\'use strict\';\nmodule.exports = { n: \'dev build\' };\n',
  'lib/prod.js': '\'use strict\';\nmodule.exports = { n: \'prod build\' };\n',
  'lib/lazy-only.js': '\'use strict\';\nexports.lazy = \'lazy\';\n',
  'lib/cycle-a.js': '\'use strict\';\nvar b = require(\'./cycle-b\');\n\nexports.a = function () { return b.b; };\n',
  'lib/cycle-b.js': '\'use strict\';\nvar a = require(\'./cycle-a\');\n\nexports.b = 2;\nexports.again = function () { return a.a(); };\n',
  // View pass: both client.js files are dynamic imports of the bootstrap.
  'components/early/client.js': conditional('../../lib'),
  'components/late/client.js': unconditional('../../lib'),
  // Kiln pass: model.js files plus a Kiln plugin entry with two styled panels.
  'components/early/model.js': conditional('../../lib'),
  'components/late/model.js': unconditional('../../lib'),
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
 * The child build's environment: NODE_ENV unset, as in a production image
 * build (Jest sets it to 'test'), so Vite sets it during the build.
 *
 * @param {string} delay
 * @returns {object}
 */
function buildEnv(delay) {
  const env = { ...process.env, DELAY: delay };

  delete env.NODE_ENV;

  return env;
}

/**
 * Write the fixture into a fresh directory and run buildJS() over it in a
 * child process (Vite's CommonJS entry loads its ESM build through a dynamic
 * import(), which Jest's module VM refuses).
 *
 * @param {string} name   subdirectory of tmpDir
 * @param {object} [opts]
 * @param {string} [opts.delay]  'early' | 'late': which files load late
 * @param {string} [opts.mode]   'default' | 'no-check'
 * @returns {{ status: number, output: string, dir: string }}
 */
function build(name, { delay = '', mode = 'default' } = {}) {
  const dir = path.join(tmpDir, name);
  const runner = path.join(tmpDir, 'run-build.js');

  for (const [file, code] of Object.entries(FIXTURE)) {
    fs.outputFileSync(path.join(dir, file), code);
  }
  fs.writeFileSync(runner, RUNNER);

  try {
    const output = execFileSync(process.execPath, [
      runner,
      dir,
      mode,
      require.resolve('./plugins/strict-requires'),
      require.resolve('./scripts'),
    ], { encoding: 'utf8', stdio: 'pipe', env: buildEnv(delay) });

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

const kilnBundle = dir => {
  const file = globSync('public/js/.clay/vite-kiln-edit-init-*.js', { cwd: dir })[0];

  return fs.readFileSync(path.join(dir, file), 'utf8');
};

describe('vite build determinism (real build)', () => {
  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'claycli-vite-determinism-'));
  });

  afterAll(async () => {
    await fs.remove(tmpDir);
  });

  it('emits identical output whichever way the load-order races go', () => {
    const late = build('late-first', { delay: 'late' });
    const early = build('early-first', { delay: 'early' });

    expect({ status: late.status, output: late.output }).toMatchObject({ status: 0 });
    expect({ status: early.status, output: early.output }).toMatchObject({ status: 0 });

    // Delaying the unconditional requirers lets 'auto' wrap shared.js, so
    // both passes are rebuilt with the graph's answer; delaying the
    // conditional ones lets 'auto' get it right on the first try.
    expect(late.output).toMatch(/view pass: .*wrapped only by 'auto':.*lib\/shared\.js.*Rebuilding/);
    expect(late.output).toMatch(/kiln pass: .*wrapped only by 'auto':.*lib\/shared\.js.*Rebuilding/);
    expect(early.output).not.toContain('Rebuilding');
    // The aborted first attempt is not reported as a failed build.
    expect(late.output).not.toContain('Build failed');

    expect(outputTree(late.dir)).toEqual(outputTree(early.dir));
    expect(Object.keys(outputTree(late.dir))).toEqual(expect.arrayContaining(['css/_kiln-plugins.css', 'js/_manifest.json']));

    // The graph's answer: shared.js has an unconditional requirer, so it is
    // hoisted, not wrapped.
    expect(kilnBundle(late.dir)).not.toMatch(/function requireShared\b/);
    expect(kilnBundle(late.dir)).toMatch(/function requireLazyOnly\b/);
    expect(kilnBundle(late.dir)).toMatch(/function requireCycleA\b/);
    expect(kilnBundle(late.dir)).toMatch(/function requireCycleB\b/);
    // NODE_ENV was unset, so both attempts bundle the development side.
    expect(kilnBundle(late.dir)).toContain('dev build');
    expect(kilnBundle(late.dir)).not.toContain('prod build');
    expect(fs.readFileSync(path.join(late.dir, 'public', 'css', '_kiln-plugins.css'), 'utf8'))
      .toBe('.early { color: red; }\n.late { color: red; }');
  });

  // Canary: proves the fixture races.  If commonjs's 'auto' ever stops
  // depending on load order, this fails, and the check may not be needed.
  it('differs between the two orders without the wrapping check', () => {
    const late = build('no-check-late', { delay: 'late', mode: 'no-check' });
    const early = build('no-check-early', { delay: 'early', mode: 'no-check' });

    expect(late.status).toBe(0);
    expect(early.status).toBe(0);
    expect(kilnBundle(late.dir)).toMatch(/function requireShared\b/);
    expect(kilnBundle(early.dir)).not.toMatch(/function requireShared\b/);
  });
});

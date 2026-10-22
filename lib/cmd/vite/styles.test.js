/* global jest:false */
'use strict';

const path = require('path');
const fs = require('fs-extra');
const os = require('os');

let tmpDir;

let originalCwd, originalCssSitesEnv, originalWorkersEnv;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'claycli-styles-'));
  originalCwd = process.cwd;
  originalCssSitesEnv = process.env.CLAYCLI_VITE_CSS_SITES;
  originalWorkersEnv = process.env.CLAYCLI_VITE_CSS_WORKERS;
  process.cwd = () => tmpDir;

  // Create a minimal CSS source tree with two styleguides
  const defaultComp = path.join(tmpDir, 'styleguides', '_default', 'components');
  const mobileComp  = path.join(tmpDir, 'styleguides', 'mobile',   'components');

  await fs.ensureDir(defaultComp);
  await fs.ensureDir(mobileComp);

  // Simple valid CSS — no @import so no postcss-import resolution needed
  await fs.writeFile(path.join(defaultComp, 'article.css'),       'body { color: red; }');
  await fs.writeFile(path.join(defaultComp, 'article_amp.css'),   'body { color: blue; }');
  await fs.writeFile(path.join(mobileComp,  'article.css'),       'body { color: green; }');
});

afterEach(async () => {
  process.cwd = originalCwd;
  if (originalCssSitesEnv === undefined) {
    delete process.env.CLAYCLI_VITE_CSS_SITES;
  } else {
    process.env.CLAYCLI_VITE_CSS_SITES = originalCssSitesEnv;
  }
  if (originalWorkersEnv === undefined) {
    delete process.env.CLAYCLI_VITE_CSS_WORKERS;
  } else {
    process.env.CLAYCLI_VITE_CSS_WORKERS = originalWorkersEnv;
  }
  await fs.remove(tmpDir);
  jest.resetModules();
});

describe('buildStyles', () => {
  it('compiles all CSS files to public/css/', async () => {
    const { buildStyles } = require('./styles');
    const results = await buildStyles();

    expect(results.length).toBeGreaterThanOrEqual(3);

    const dest = path.join(tmpDir, 'public', 'css');

    expect(fs.existsSync(path.join(dest, 'article._default.css'))).toBe(true);
    expect(fs.existsSync(path.join(dest, 'article_amp._default.css'))).toBe(true);
    expect(fs.existsSync(path.join(dest, 'article.mobile.css'))).toBe(true);
  });

  it('output filenames follow the {component}.{styleguide}.css pattern', async () => {
    const { buildStyles } = require('./styles');
    const results = await buildStyles();

    for (const file of results) {
      expect(path.basename(file)).toMatch(/^.+\..+\.css$/);
    }
  });

  it('writes compiled CSS content to the output file', async () => {
    const { buildStyles } = require('./styles');

    await buildStyles();

    const content = await fs.readFile(
      path.join(tmpDir, 'public', 'css', 'article._default.css'),
      'utf8'
    );

    expect(content).toContain('color');
  });

  it('returns an empty array when no CSS source files exist', async () => {
    await fs.remove(path.join(tmpDir, 'styleguides'));

    const { buildStyles } = require('./styles');
    const results = await buildStyles();

    expect(results).toEqual([]);
  });

  it('only recompiles changedFiles when the option is provided', async () => {
    const { buildStyles } = require('./styles');
    const target = path.join(tmpDir, 'styleguides', '_default', 'components', 'article.css');
    const results = await buildStyles({ changedFiles: [target] });

    // Only 1 file compiled, not the full 3-file tree
    expect(results).toHaveLength(1);
    expect(results[0]).toMatch(/article\._default\.css$/);
  });

  it('calls onProgress with (done, total) after each file', async () => {
    const { buildStyles } = require('./styles');
    const calls = [];

    await buildStyles({ onProgress: (done, total) => calls.push({ done, total }) });

    expect(calls.length).toBeGreaterThan(0);
    // Progress should be monotonically increasing
    for (let i = 1; i < calls.length; i++) {
      expect(calls[i].done).toBeGreaterThan(calls[i - 1].done);
    }
    // Final call should report all files done
    const last = calls[calls.length - 1];

    expect(last.done).toBe(last.total);
  });

  it('reports errors through onError, writes the other files, then fails', async () => {
    const { buildStyles } = require('./styles');

    // postcss-import fails on a missing file.
    await fs.writeFile(
      path.join(tmpDir, 'styleguides', '_default', 'components', 'broken.css'),
      "@import 'this-file-does-not-exist-at-all-xyz.css';"
    );

    const consoleErrors = [];
    const callbackErrors = [];
    const origError = console.error;

    console.error = msg => consoleErrors.push(msg);

    await expect(buildStyles({ onError: msg => callbackErrors.push(msg) })).rejects.toThrow(/1 CSS error/);

    console.error = origError;

    expect(callbackErrors).toHaveLength(1);
    expect(callbackErrors[0]).toMatch(/broken\.css/);

    // PostCSS 8 may emit an internal version-mismatch diagnostic to console.error
    // when a plugin built for the old postcss.plugin() API throws.
    expect(consoleErrors.filter(msg => !msg.includes('PostCSS plugin'))).toEqual([]);

    // The valid files still compile regardless of the broken one
    expect(fs.existsSync(path.join(tmpDir, 'public', 'css', 'article._default.css'))).toBe(true);
  });

  it('creates public/css directory if it does not exist', async () => {
    const { buildStyles } = require('./styles');

    await buildStyles();

    expect(fs.existsSync(path.join(tmpDir, 'public', 'css'))).toBe(true);
  });

  it('limits full CSS compilation to selected sites plus _default', async () => {
    process.env.CLAYCLI_VITE_CSS_SITES = 'mobile';
    const { buildStyles } = require('./styles');
    const results = await buildStyles();

    expect(results).toHaveLength(3);
    expect(fs.existsSync(path.join(tmpDir, 'public', 'css', 'article.mobile.css'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, 'public', 'css', 'article._default.css'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, 'public', 'css', 'article_amp._default.css'))).toBe(true);
  });

  it('treats "all" as compile-all behavior', async () => {
    process.env.CLAYCLI_VITE_CSS_SITES = 'all';
    const { buildStyles } = require('./styles');
    const results = await buildStyles();

    expect(results.length).toBeGreaterThanOrEqual(3);
    expect(fs.existsSync(path.join(tmpDir, 'public', 'css', 'article.mobile.css'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, 'public', 'css', 'article._default.css'))).toBe(true);
  });

  it('does not filter watcher changedFiles by CLAYCLI_VITE_CSS_SITES', async () => {
    process.env.CLAYCLI_VITE_CSS_SITES = 'mobile';
    const { buildStyles } = require('./styles');
    const defaultFile = path.join(tmpDir, 'styleguides', '_default', 'components', 'article.css');
    const results = await buildStyles({ changedFiles: [defaultFile] });

    expect(results).toHaveLength(1);
    expect(results[0]).toMatch(/article\._default\.css$/);
  });

  describe('getWorkerCount', () => {
    function workerCount(cpus, fileCount) {
      jest.resetModules();
      jest.doMock('os', () => ({ ...jest.requireActual('os'), availableParallelism: () => cpus }));
      return require('./styles').getWorkerCount(fileCount);
    }

    afterEach(() => jest.dontMock('os'));

    it('is one less than the available CPUs, so one is left for the js step', () => {
      expect(workerCount(4, 2872)).toBe(3);
      expect(workerCount(3, 2872)).toBe(2);
    });

    it('stays on the main thread with two CPUs or fewer, where one worker would gain nothing', () => {
      expect(workerCount(2, 2872)).toBe(0);
      expect(workerCount(1, 2872)).toBe(0);
    });

    it('stops at 8 workers', () => {
      expect(workerCount(14, 2872)).toBe(8);
      expect(workerCount(64, 2872)).toBe(8);
    });

    it('stays on the main thread below 200 files', () => {
      expect(workerCount(14, 199)).toBe(0);
      expect(workerCount(14, 200)).toBe(8);
    });

    it('takes CLAYCLI_VITE_CSS_WORKERS exactly, up to the file count', () => {
      process.env.CLAYCLI_VITE_CSS_WORKERS = '13';
      expect(workerCount(2, 2872)).toBe(13);
      expect(workerCount(2, 5)).toBe(5);
      process.env.CLAYCLI_VITE_CSS_WORKERS = '0';
      expect(workerCount(14, 2872)).toBe(0);
    });
  });

  describe('worker threads', () => {
    const outputs = async () => {
      const dest = path.join(tmpDir, 'public', 'css');
      const files = (await fs.readdir(dest)).sort();

      return Promise.all(files.map(async f => [f, await fs.readFile(path.join(dest, f), 'utf8')]));
    };

    beforeEach(async () => {
      const comp = path.join(tmpDir, 'styleguides', '_default', 'components');

      await fs.outputJson(path.join(tmpDir, 'styleguides', '_default', 'tokens.json'), { color: { brand: { $value: '#00f' } } });
      await fs.writeFile(path.join(tmpDir, 'styleguides', '_default', '_shared.css'), '.shared { top: 0; }');
      await fs.writeFile(path.join(comp, 'nav.css'),
        "@import '_default/_shared.css';\n.nav { color: var(--color-brand); user-select: none; &:hover { margin: 0 auto; } }");
    });

    it('writes the same CSS as compiling on the main thread', async () => {
      process.env.CLAYCLI_VITE_CSS_WORKERS = '0';
      await require('./styles').buildStyles({ minify: true });
      const inProcess = await outputs();

      await fs.remove(path.join(tmpDir, 'public'));
      process.env.CLAYCLI_VITE_CSS_WORKERS = '2';
      const results = await require('./styles').buildStyles({ minify: true });

      expect(results).toHaveLength(inProcess.length);
      expect(await outputs()).toEqual(inProcess);
      expect(inProcess.find(([f]) => f === 'nav._default.css')[1]).toContain('.shared{top:0}.nav{color:#00f');
    });

    it('runs the stylesConfig hook and its PostCSS plugins in each worker', async () => {
      await fs.writeFile(path.join(tmpDir, 'claycli.config.js'), `
        module.exports.stylesConfig = config => {
          config.pipeline = 'postcss';
          config.minify = true;
          config.plugins.push({ postcssPlugin: 'brand', Declaration: { color: decl => { decl.value = 'green'; } } });
        };`);
      process.env.CLAYCLI_VITE_CSS_WORKERS = '2';
      await require('./styles').buildStyles();

      expect(await fs.readFile(path.join(tmpDir, 'public', 'css', 'article.mobile.css'), 'utf8')).toBe('body{color:green}');
    });

    it('rejects when the stylesConfig hook throws', async () => {
      await fs.writeFile(path.join(tmpDir, 'claycli.config.js'),
        "module.exports.stylesConfig = () => { throw new Error('bad hook'); };");
      process.env.CLAYCLI_VITE_CSS_WORKERS = '2';

      await expect(require('./styles').buildStyles()).rejects.toThrow('bad hook');
    });
  });

  it('reports invalid CSS once per source location, with the number of output files, and fails', async () => {
    const shared = path.join(tmpDir, 'styleguides', '_default', '_shared.css');

    await fs.writeFile(shared, '.shared {\n  color: red !importnt;\n}');
    for (const sg of ['_default', 'mobile']) {
      await fs.writeFile(path.join(tmpDir, 'styleguides', sg, 'components', 'uses-shared.css'), "@import '_default/_shared.css';");
    }

    const errors = [];

    await expect(require('./styles').buildStyles({ onError: msg => errors.push(msg) })).rejects.toThrow(/1 CSS error/);

    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/^\[styles\] Invalid CSS in styleguides\/_default\/_shared\.css:2:3: .*\(2 output files\)$/);
    expect(fs.existsSync(path.join(tmpDir, 'public', 'css', 'uses-shared.mobile.css'))).toBe(true);
  });

  it('warns that autoprefixerOptions is not used', async () => {
    await fs.writeFile(path.join(tmpDir, 'claycli.config.js'),
      "module.exports.stylesConfig = c => { c.autoprefixerOptions = { overrideBrowserslist: ['> 2%'] }; };");
    const warnings = [];

    await require('./styles').buildStyles({ onWarning: msg => warnings.push(msg) });

    expect(warnings).toEqual([expect.stringMatching(/autoprefixerOptions is ignored/)]);
  });
});

'use strict';

const path = require('path');
const fs = require('fs-extra');
const os = require('os');

let tmpDir;
let originalCwd;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'claycli-styles-'));
  originalCwd = process.cwd;
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

  it('routes errors through onError callback instead of console.error', async () => {
    const { buildStyles } = require('./styles');

    // A file with a CSS @import of a non-existent path triggers a postcss-import error.
    // This mirrors the real-world "Unexpected '/'" errors from text-list_amp.css.
    await fs.writeFile(
      path.join(tmpDir, 'styleguides', '_default', 'components', 'broken.css'),
      "@import 'this-file-does-not-exist-at-all-xyz.css';"
    );

    const consoleErrors = [];
    const callbackErrors = [];
    const origError = console.error;

    console.error = msg => consoleErrors.push(msg);

    await buildStyles({ onError: msg => callbackErrors.push(msg) });

    console.error = origError;

    // Error should be routed through callback, NOT console.error
    if (callbackErrors.length > 0 || consoleErrors.length > 0) {
      expect(callbackErrors.length).toBeGreaterThan(0);
      expect(consoleErrors.length).toBe(0);
    }

    // The valid files still compile regardless of the broken one
    expect(fs.existsSync(path.join(tmpDir, 'public', 'css', 'article._default.css'))).toBe(true);
  });

  it('creates public/css directory if it does not exist', async () => {
    const { buildStyles } = require('./styles');

    await buildStyles();

    expect(fs.existsSync(path.join(tmpDir, 'public', 'css'))).toBe(true);
  });
});

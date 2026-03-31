/* global jest:false */
'use strict';

const path = require('path');
const fs = require('fs-extra');
const os = require('os');

let tmpDir;

let originalCwd;

let kilnDist;

let fakeResolve;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'claycli-vendor-'));
  originalCwd = process.cwd;
  process.cwd = () => tmpDir;

  // Build a fake clay-kiln dist inside tmpDir so tests never need the real package
  kilnDist = path.join(tmpDir, 'fake-kiln', 'dist');
  await fs.ensureDir(kilnDist);
  await fs.writeFile(path.join(kilnDist, 'clay-kiln-edit.js'), '// fake edit bundle');
  await fs.writeFile(path.join(kilnDist, 'clay-kiln-view.js'), '// fake view bundle');

  fakeResolve = () => path.join(kilnDist, 'clay-kiln-edit.js');
});

afterEach(async () => {
  process.cwd = originalCwd;
  await fs.remove(tmpDir);
  jest.resetModules();
});

describe('copyVendor', () => {
  it('returns [] and warns when clay-kiln is not installed', async () => {
    const throwingResolve = () => { throw new Error("Cannot find module 'clay-kiln/dist/clay-kiln-edit.js'"); };
    const warns = [];
    const origWarn = console.warn;

    console.warn = msg => warns.push(msg);

    const { copyVendor } = require('./vendor');
    const results = await copyVendor(throwingResolve);

    console.warn = origWarn;

    expect(results).toEqual([]);
    expect(warns.length).toBeGreaterThan(0);
    expect(warns[0]).toMatch(/clay-kiln not found/);
  });

  it('copies clay-kiln-edit.js and clay-kiln-view.js to public/js/', async () => {
    const { copyVendor } = require('./vendor');
    const results = await copyVendor(fakeResolve);

    expect(results).toHaveLength(2);
    expect(fs.existsSync(path.join(tmpDir, 'public', 'js', 'clay-kiln-edit.js'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, 'public', 'js', 'clay-kiln-view.js'))).toBe(true);
  });

  it('returns the destination paths for each copied file', async () => {
    const { copyVendor } = require('./vendor');
    const results = await copyVendor(fakeResolve);

    const expectedDest = path.join(tmpDir, 'public', 'js');

    for (const dest of results) {
      expect(dest).toContain(expectedDest);
    }
    expect(results.some(r => r.endsWith('clay-kiln-edit.js'))).toBe(true);
    expect(results.some(r => r.endsWith('clay-kiln-view.js'))).toBe(true);
  });

  it('creates public/js directory if it does not exist', async () => {
    const { copyVendor } = require('./vendor');

    await copyVendor(fakeResolve);

    expect(fs.existsSync(path.join(tmpDir, 'public', 'js'))).toBe(true);
  });

  it('overwrites existing files without error', async () => {
    const dest = path.join(tmpDir, 'public', 'js');

    await fs.ensureDir(dest);
    await fs.writeFile(path.join(dest, 'clay-kiln-edit.js'), '// old content');

    const { copyVendor } = require('./vendor');
    const results = await copyVendor(fakeResolve);

    expect(results).toHaveLength(2);

    const content = await fs.readFile(path.join(dest, 'clay-kiln-edit.js'), 'utf8');

    expect(content).toBe('// fake edit bundle');
  });

  it('skips a missing source file and warns', async () => {
    // Remove one of the fake dist files to trigger the per-file error path
    await fs.remove(path.join(kilnDist, 'clay-kiln-view.js'));

    const warns = [];
    const origWarn = console.warn;

    console.warn = msg => warns.push(msg);

    const { copyVendor } = require('./vendor');
    const results = await copyVendor(fakeResolve);

    console.warn = origWarn;

    expect(results).toHaveLength(1);
    expect(results[0]).toMatch(/clay-kiln-edit\.js$/);
    expect(warns.some(w => w.includes('clay-kiln-view.js'))).toBe(true);
  });
});

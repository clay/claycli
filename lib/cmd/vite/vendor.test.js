/* global jest:false */
'use strict';

const path = require('path');
const fs = require('fs-extra');
const os = require('os');

// clay-kiln is symlinked into node_modules from the local clay-kiln project.
// vendor.js will resolve it via require.resolve at runtime.

let tmpDir;

let originalCwd;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'claycli-vendor-'));
  originalCwd = process.cwd;
  process.cwd = () => tmpDir;
});

afterEach(async () => {
  process.cwd = originalCwd;
  await fs.remove(tmpDir);
  jest.resetModules();
});

describe('copyVendor', () => {
  it('copies clay-kiln-edit.js and clay-kiln-view.js to public/js/', async () => {
    const { copyVendor } = require('./vendor');
    const results = await copyVendor();

    expect(results).toHaveLength(2);
    expect(fs.existsSync(path.join(tmpDir, 'public', 'js', 'clay-kiln-edit.js'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, 'public', 'js', 'clay-kiln-view.js'))).toBe(true);
  });

  it('returns the destination paths for each copied file', async () => {
    const { copyVendor } = require('./vendor');
    const results = await copyVendor();

    const expectedDest = path.join(tmpDir, 'public', 'js');

    for (const dest of results) {
      expect(dest).toContain(expectedDest);
    }
    expect(results.some(r => r.endsWith('clay-kiln-edit.js'))).toBe(true);
    expect(results.some(r => r.endsWith('clay-kiln-view.js'))).toBe(true);
  });

  it('creates public/js directory if it does not exist', async () => {
    const { copyVendor } = require('./vendor');

    await copyVendor();

    expect(fs.existsSync(path.join(tmpDir, 'public', 'js'))).toBe(true);
  });

  it('overwrites existing files without error', async () => {
    const dest = path.join(tmpDir, 'public', 'js');

    await fs.ensureDir(dest);
    await fs.writeFile(path.join(dest, 'clay-kiln-edit.js'), '// old content');

    const { copyVendor } = require('./vendor');
    const results = await copyVendor();

    expect(results).toHaveLength(2);

    // File should have been overwritten with real clay-kiln content (not empty/old)
    const stat = await fs.stat(path.join(dest, 'clay-kiln-edit.js'));

    expect(stat.size).toBeGreaterThan(0);
  });

  it('skips a file that cannot be copied and warns', async () => {
    // require a fresh fs-extra instance (same one vendor.js will use after resetModules)
    const freshFs = require('fs-extra');
    const realCopy = freshFs.copy.bind(freshFs);

    // Let edit.js copy succeed; throw on view.js to trigger the per-file warn path
    jest.spyOn(freshFs, 'copy').mockImplementation((src, dest, opts) => {
      if (src.endsWith('clay-kiln-view.js')) {
        throw new Error('ENOENT: simulated');
      }
      return realCopy(src, dest, opts);
    });

    const warns = [];
    const origWarn = console.warn;

    console.warn = msg => warns.push(msg);

    const { copyVendor } = require('./vendor');
    const results = await copyVendor();

    console.warn = origWarn;
    jest.restoreAllMocks();

    expect(results).toHaveLength(1);
    expect(results[0]).toMatch(/clay-kiln-edit\.js$/);
    expect(warns.some(w => w.includes('clay-kiln-view.js'))).toBe(true);
  });
});

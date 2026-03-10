/* global jest:false */
'use strict';

const path = require('path');
const fs = require('fs-extra');
const os = require('os');

// We need to set CWD before requiring the module because it captures CWD at
// require-time.  We temporarily override process.cwd() for each test.
let tmpDir;

let originalCwd;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'claycli-media-'));
  originalCwd = process.cwd;
  process.cwd = () => tmpDir;

  // Create representative media source tree
  await fs.ensureDir(path.join(tmpDir, 'components', 'article', 'media'));
  await fs.writeFile(path.join(tmpDir, 'components', 'article', 'media', 'hero.jpg'), 'jpg');
  await fs.writeFile(path.join(tmpDir, 'components', 'article', 'media', 'logo.svg'), '<svg/>');

  await fs.ensureDir(path.join(tmpDir, 'layouts', 'default', 'media'));
  await fs.writeFile(path.join(tmpDir, 'layouts', 'default', 'media', 'bg.png'), 'png');
});

afterEach(async () => {
  process.cwd = originalCwd;
  await fs.remove(tmpDir);
  jest.resetModules();
});

describe('copyMedia', () => {
  it('copies component media files to public/media/components/', async () => {
    const { copyMedia } = require('./media');
    const count = await copyMedia();

    expect(count).toBeGreaterThanOrEqual(2);

    const hero = path.join(tmpDir, 'public', 'media', 'components', 'article', 'hero.jpg');
    const logo = path.join(tmpDir, 'public', 'media', 'components', 'article', 'logo.svg');

    expect(fs.existsSync(hero)).toBe(true);
    expect(fs.existsSync(logo)).toBe(true);
  });

  it('copies layout media files to public/media/layouts/', async () => {
    const { copyMedia } = require('./media');

    await copyMedia();

    const bg = path.join(tmpDir, 'public', 'media', 'layouts', 'default', 'bg.png');

    expect(fs.existsSync(bg)).toBe(true);
  });

  it('returns 0 when no media files exist', async () => {
    // Remove all media from the fixture
    await fs.remove(path.join(tmpDir, 'components'));
    await fs.remove(path.join(tmpDir, 'layouts'));

    const { copyMedia } = require('./media');
    const count = await copyMedia();

    expect(count).toBe(0);
  });

  it('returns total count of all files copied', async () => {
    const { copyMedia } = require('./media');
    const count = await copyMedia();

    // 2 component files + 1 layout file
    expect(count).toBe(3);
  });

  it('creates public/media directory if it does not exist', async () => {
    const { copyMedia } = require('./media');

    await copyMedia();

    expect(fs.existsSync(path.join(tmpDir, 'public', 'media'))).toBe(true);
  });
});

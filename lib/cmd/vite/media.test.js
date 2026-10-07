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

describe('copyMedia: site media', () => {
  const write = (rel, content) => fs.outputFile(path.join(tmpDir, rel), content);
  const read = (rel) => fs.readFile(path.join(tmpDir, 'public', 'media', rel), 'utf8');
  const exists = (rel) => fs.pathExists(path.join(tmpDir, 'public', 'media', rel));

  /**
   * List every file under a directory as { 'relative/path': 'contents' }
   * @param {string} dir
   * @returns {Promise<object>}
   */
  async function snapshot(dir) {
    const out = {};

    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        for (const [rel, content] of Object.entries(await snapshot(full))) out[`${entry.name}/${rel}`] = content;
      } else {
        out[entry.name] = await fs.readFile(full, 'utf8');
      }
    }

    return out;
  }

  beforeEach(async () => {
    // only site media in these tests, so counts are exact
    await fs.remove(path.join(tmpDir, 'components'));
    await fs.remove(path.join(tmpDir, 'layouts'));

    // a site with two subsites: `uk` overrides some files and adds one, `au` has no media dir at all
    await write('sites/strategist/media/logo.svg', 'parent-logo');
    await write('sites/strategist/media/favicon.ico', 'parent-favicon');
    await write('sites/strategist/media/og.png', 'parent-og');
    await write('sites/strategist/subsites/uk/media/logo.svg', 'uk-logo');
    await write('sites/strategist/subsites/uk/media/og.png', 'uk-og');
    await write('sites/strategist/subsites/uk/media/uk-only.png', 'uk-only');
    await fs.ensureDir(path.join(tmpDir, 'sites', 'strategist', 'subsites', 'au'));
    // a site without subsites
    await write('sites/vulture/media/favicon.ico', 'vulture-favicon');
  });

  it('copies a site\'s own media to public/media/sites/<site>/', async () => {
    const { copyMedia } = require('./media');

    await copyMedia();

    expect(await read('sites/strategist/logo.svg')).toBe('parent-logo');
    expect(await read('sites/strategist/favicon.ico')).toBe('parent-favicon');
    expect(await read('sites/vulture/favicon.ico')).toBe('vulture-favicon');
  });

  describe('subsites', () => {
    it('writes to public/media/sites/<site>/<subsite>/, the slug Amphora and templates read', async () => {
      const { copyMedia } = require('./media');

      await copyMedia();

      expect(await exists('sites/strategist/uk/logo.svg')).toBe(true);
      expect(await exists('sites/strategist/au/logo.svg')).toBe(true);
    });

    it('does not write the literal subsites/ segment, which clay compile never wrote', async () => {
      const { copyMedia } = require('./media');

      await copyMedia();

      expect(await exists('sites/strategist/subsites')).toBe(false);
    });

    it('inherits the parent site\'s media', async () => {
      const { copyMedia } = require('./media');

      await copyMedia();

      expect(await read('sites/strategist/uk/favicon.ico')).toBe('parent-favicon');
    });

    it('inherits the parent site\'s media when the subsite has no media directory of its own', async () => {
      const { copyMedia } = require('./media');

      await copyMedia();

      expect(await snapshot(path.join(tmpDir, 'public', 'media', 'sites', 'strategist', 'au'))).toEqual({
        'logo.svg': 'parent-logo',
        'favicon.ico': 'parent-favicon',
        'og.png': 'parent-og'
      });
    });

    it('lets the subsite\'s files override same-named parent files', async () => {
      const { copyMedia } = require('./media');

      await copyMedia();

      expect(await read('sites/strategist/uk/logo.svg')).toBe('uk-logo');
      expect(await read('sites/strategist/uk/og.png')).toBe('uk-og');
    });

    it('keeps files that only the subsite has', async () => {
      const { copyMedia } = require('./media');

      await copyMedia();

      expect(await read('sites/strategist/uk/uk-only.png')).toBe('uk-only');
    });

    it('does not leak a subsite\'s overrides into the parent site or sibling subsites', async () => {
      const { copyMedia } = require('./media');

      await copyMedia();

      expect(await read('sites/strategist/logo.svg')).toBe('parent-logo');
      expect(await read('sites/strategist/au/logo.svg')).toBe('parent-logo');
      expect(await exists('sites/strategist/uk-only.png')).toBe(false);
      expect(await exists('sites/strategist/au/uk-only.png')).toBe(false);
    });

    it('gives the subsite everything the parent site gets, wherever it sits in media/', async () => {
      await write('sites/strategist/media/icons/nested.png', 'nested');
      await write('sites/strategist/media/guide.pdf', 'pdf');

      const { copyMedia } = require('./media');

      await copyMedia();

      expect(await read('sites/strategist/icons/nested.png')).toBe('nested');
      expect(await read('sites/strategist/uk/icons/nested.png')).toBe('nested');
      expect(await read('sites/strategist/uk/guide.pdf')).toBe('pdf');
    });

    it('copies the subsite\'s own media when the parent site has none', async () => {
      await fs.remove(path.join(tmpDir, 'sites', 'strategist', 'media'));

      const { copyMedia } = require('./media');

      await copyMedia();

      expect(await snapshot(path.join(tmpDir, 'public', 'media', 'sites', 'strategist', 'uk'))).toEqual({
        'logo.svg': 'uk-logo',
        'og.png': 'uk-og',
        'uk-only.png': 'uk-only'
      });
      expect(await exists('sites/strategist/au')).toBe(false);
    });

    it('ignores files in subsites/ that are not subsite directories', async () => {
      await write('sites/strategist/subsites/README.md', 'not a subsite');
      await write('sites/strategist/subsites/.DS_Store', 'not a subsite');

      const { copyMedia } = require('./media');

      await copyMedia();

      expect(await exists('sites/strategist/README.md')).toBe(false);
      expect(await exists('sites/strategist/.DS_Store')).toBe(false);
      expect(await exists('sites/strategist/uk/logo.svg')).toBe(true);
    });

    it('counts each file in public/media once, not the inherited copy and its override separately', async () => {
      const { copyMedia } = require('./media');

      const count = await copyMedia();

      // strategist: 3, strategist/uk: 3 inherited with 2 overridden + 1 added = 4, strategist/au: 3, vulture: 1
      expect(count).toBe(11);
    });

    it('is idempotent: a second run leaves the same files with the same contents', async () => {
      const { copyMedia } = require('./media');

      await copyMedia();
      const first = await snapshot(path.join(tmpDir, 'public'));

      await copyMedia();

      expect(await snapshot(path.join(tmpDir, 'public'))).toEqual(first);
    });

    it('writes the same files as clay compile for the same sites tree', async () => {
      // clay compile reads the project's package.json to find components
      await write('package.json', '{}');
      // Leave out the same-named overrides. clay compile copies the parent's files and the subsite's
      // files in two parallel streams to the same destination (through gulp-changed), so which one
      // wins depends on source mtimes and timing, and it can even write a torn file. Overrides are
      // covered deterministically above; this compares the layout and what each subsite inherits.
      await fs.remove(path.join(tmpDir, 'sites', 'strategist', 'subsites', 'uk', 'media', 'logo.svg'));
      await fs.remove(path.join(tmpDir, 'sites', 'strategist', 'subsites', 'uk', 'media', 'og.png'));

      const { copyMedia } = require('./media');

      await copyMedia();
      const vite = await snapshot(path.join(tmpDir, 'public', 'media', 'sites'));

      await fs.remove(path.join(tmpDir, 'public'));

      const { build } = require('../compile/media')();

      await new Promise((resolve, reject) => build.errors(reject).done(resolve));

      expect(vite).toEqual(await snapshot(path.join(tmpDir, 'public', 'media', 'sites')));
      expect(Object.keys(vite).sort()).toContain('strategist/uk/favicon.ico');
    });
  });
});

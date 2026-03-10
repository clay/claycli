/* global jest:false */
'use strict';

const path = require('path');
const fs = require('fs-extra');
const os = require('os');

let tmpDir;

let originalCwd;

// Helpers to write a manifest file in the test temp dir
async function writeManifestFixture(manifest) {
  const dest = path.join(tmpDir, 'public', 'js');

  await fs.ensureDir(dest);
  await fs.writeJson(path.join(dest, '_manifest.json'), manifest);
}

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'claycli-getdeps-'));
  originalCwd = process.cwd;
  process.cwd = () => tmpDir;
});

afterEach(async () => {
  process.cwd = originalCwd;
  await fs.remove(tmpDir);
  jest.resetModules();
});

// ---------------------------------------------------------------------------
// hasManifest
// ---------------------------------------------------------------------------
describe('hasManifest', () => {
  it('returns false when no manifest has been built', () => {
    const { hasManifest } = require('./get-script-dependencies');

    expect(hasManifest()).toBe(false);
  });

  it('returns true after a manifest is present on disk', async () => {
    await writeManifestFixture({});
    const { hasManifest } = require('./get-script-dependencies');

    expect(hasManifest()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// getDependenciesNextForComponents
// Returns the _view-init bundle + named global script bundles.
// Individual component scripts are NOT included here — _view-init loads them
// on demand by scanning the DOM at runtime.
// ---------------------------------------------------------------------------
describe('getDependenciesNextForComponents', () => {
  const ASSET_PATH = '/assets';

  const VIEW_INIT_MANIFEST = {
    '.clay/_view-init': {
      file: '/js/.clay/_view-init-V1.js',
      imports: ['/js/chunks/shared-C3.js'],
    },
    'global/js/aaa-module-mounting': {
      file: '/js/global/js/aaa-module-mounting-G1.js',
      imports: ['/js/chunks/shared-C3.js'],
    },
    'global/js/ads': {
      file: '/js/global/js/ads-G2.js',
      imports: [],
    },
    'chunks/shared-C3': {
      file: '/js/chunks/shared-C3.js',
      imports: [],
    },
  };

  it('throws a descriptive error when no manifest exists', () => {
    const { getDependenciesNextForComponents } = require('./get-script-dependencies');

    expect(() => getDependenciesNextForComponents(ASSET_PATH, [])).toThrow(
      /clay build.*_manifest\.json not found/
    );
  });

  it('returns empty array when manifest has no _view-init and no globalKeys', async () => {
    await writeManifestFixture({ 'components/article/client': { file: '/js/article.js', imports: [] } });
    const { getDependenciesNextForComponents } = require('./get-script-dependencies');

    const result = getDependenciesNextForComponents(ASSET_PATH, []);

    expect(result).toEqual([]);
  });

  it('returns _view-init bundle when present in manifest', async () => {
    await writeManifestFixture(VIEW_INIT_MANIFEST);
    const { getDependenciesNextForComponents } = require('./get-script-dependencies');

    const result = getDependenciesNextForComponents(ASSET_PATH, []);

    expect(result.some(s => s.includes('_view-init'))).toBe(true);
  });

  it('includes _view-init shared chunks', async () => {
    await writeManifestFixture(VIEW_INIT_MANIFEST);
    const { getDependenciesNextForComponents } = require('./get-script-dependencies');

    const result = getDependenciesNextForComponents(ASSET_PATH, []);

    expect(result.some(s => s.includes('shared-C3'))).toBe(true);
  });

  it('includes requested global script bundles', async () => {
    await writeManifestFixture(VIEW_INIT_MANIFEST);
    const { getDependenciesNextForComponents } = require('./get-script-dependencies');

    const result = getDependenciesNextForComponents(ASSET_PATH, ['global/js/ads']);

    expect(result.some(s => s.includes('ads'))).toBe(true);
  });

  it('deduplicates shared chunks across _view-init and global scripts', async () => {
    await writeManifestFixture(VIEW_INIT_MANIFEST);
    const { getDependenciesNextForComponents } = require('./get-script-dependencies');

    // Both _view-init and aaa-module-mounting import shared-C3
    const result = getDependenciesNextForComponents(ASSET_PATH, ['global/js/aaa-module-mounting']);
    const sharedCount = result.filter(s => s.includes('shared-C3')).length;

    expect(sharedCount).toBe(1);
  });

  it('prepends _view-init bundle before any global scripts', async () => {
    await writeManifestFixture(VIEW_INIT_MANIFEST);
    const { getDependenciesNextForComponents } = require('./get-script-dependencies');

    const result = getDependenciesNextForComponents(ASSET_PATH, ['global/js/aaa-module-mounting']);

    const viewInitIdx = result.findIndex(s => s.includes('_view-init'));
    const globalIdx   = result.findIndex(s => s.includes('aaa-module-mounting'));

    expect(viewInitIdx).toBeGreaterThanOrEqual(0);
    if (globalIdx !== -1) {
      expect(viewInitIdx).toBeLessThan(globalIdx);
    }
  });

  it('applies assetPath prefix to output URLs', async () => {
    await writeManifestFixture(VIEW_INIT_MANIFEST);
    const { getDependenciesNextForComponents } = require('./get-script-dependencies');

    const result = getDependenciesNextForComponents('https://cdn.example.com', []);

    expect(result.every(s => s.startsWith('https://cdn.example.com'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// getDependenciesNext — per-component script resolver (view mode)
// Takes public script paths from amphora and resolves them to hashed URLs.
// ---------------------------------------------------------------------------
describe('getDependenciesNext (view mode)', () => {
  const ASSET_PATH = '/assets';

  const BASE_MANIFEST = {
    'components/article/client': {
      file: '/js/components/article/client-A1.js',
      imports: ['/js/chunks/vendor-C3.js'],
    },
    'components/paragraph/client': {
      file: '/js/components/paragraph/client-B2.js',
      imports: [],
    },
    'chunks/vendor-C3': {
      file: '/js/chunks/vendor-C3.js',
      imports: [],
    },
  };

  it('throws when no manifest exists', () => {
    const { getDependenciesNext } = require('./get-script-dependencies');

    expect(() => getDependenciesNext(['/assets/js/article.client.js'], ASSET_PATH)).toThrow(
      /clay build.*_manifest\.json not found/
    );
  });

  it('returns script paths for a component present in the manifest', async () => {
    await writeManifestFixture(BASE_MANIFEST);
    const { getDependenciesNext } = require('./get-script-dependencies');

    const result = getDependenciesNext(['/assets/js/article.client.js'], ASSET_PATH);

    expect(result.some(s => s.includes('article'))).toBe(true);
  });

  it('includes shared chunk imports in the result', async () => {
    await writeManifestFixture(BASE_MANIFEST);
    const { getDependenciesNext } = require('./get-script-dependencies');

    const result = getDependenciesNext(['/assets/js/article.client.js'], ASSET_PATH);

    expect(result.some(s => s.includes('vendor-C3'))).toBe(true);
  });

  it('does not include chunks for components not on the page', async () => {
    await writeManifestFixture(BASE_MANIFEST);
    const { getDependenciesNext } = require('./get-script-dependencies');

    const result = getDependenciesNext(['/assets/js/paragraph.client.js'], ASSET_PATH);

    expect(result.some(s => s.includes('vendor-C3'))).toBe(false);
  });

  it('deduplicates shared chunks when multiple components import the same one', async () => {
    const manifest = {
      'components/article/client': {
        file: '/js/components/article/client-A1.js',
        imports: ['/js/chunks/shared-X.js'],
      },
      'components/gallery/client': {
        file: '/js/components/gallery/client-G2.js',
        imports: ['/js/chunks/shared-X.js'],
      },
    };

    await writeManifestFixture(manifest);
    const { getDependenciesNext } = require('./get-script-dependencies');

    const scripts = ['/assets/js/article.client.js', '/assets/js/gallery.client.js'];
    const result = getDependenciesNext(scripts, ASSET_PATH);
    const sharedCount = result.filter(s => s.includes('shared-X')).length;

    expect(sharedCount).toBe(1);
  });

  it('skips public paths not mappable to a manifest entry', async () => {
    await writeManifestFixture(BASE_MANIFEST);
    const { getDependenciesNext } = require('./get-script-dependencies');

    const result = getDependenciesNext(
      ['/assets/js/article.client.js', '/assets/js/missing-component.client.js'],
      ASSET_PATH
    );

    expect(result.some(s => s.includes('article'))).toBe(true);
    expect(result.some(s => s.includes('missing'))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getTemplatePaths (non-minified)
// ---------------------------------------------------------------------------
describe('getTemplatePaths', () => {
  it('returns an empty array when no template files exist', () => {
    const { getTemplatePaths } = require('./get-script-dependencies');

    expect(getTemplatePaths()).toEqual([]);
  });

  it('returns paths for compiled template files', async () => {
    const jsDest = path.join(tmpDir, 'public', 'js');

    await fs.ensureDir(jsDest);
    await fs.writeFile(path.join(jsDest, 'article.template.js'), '');
    await fs.writeFile(path.join(jsDest, 'paragraph.template.js'), '');

    const { getTemplatePaths } = require('./get-script-dependencies');
    const paths = getTemplatePaths();

    expect(paths.length).toBeGreaterThanOrEqual(2);
    expect(paths.every(p => p.endsWith('.template.js'))).toBe(true);
  });
});

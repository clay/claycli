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
// ---------------------------------------------------------------------------
describe('getDependenciesNextForComponents', () => {
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
    // Shared chunk — NOT an entry point
    'chunks/vendor-C3': {
      file: '/js/chunks/vendor-C3.js',
      imports: [],
    },
  };

  it('throws a descriptive error when no manifest exists', () => {
    const { getDependenciesNextForComponents } = require('./get-script-dependencies');

    expect(() => getDependenciesNextForComponents(['article'], ASSET_PATH, [])).toThrow(
      /clay build.*_manifest\.json not found/
    );
  });

  it('returns script paths for a component present in the manifest', async () => {
    await writeManifestFixture(BASE_MANIFEST);
    const { getDependenciesNextForComponents } = require('./get-script-dependencies');

    const result = getDependenciesNextForComponents(['article'], ASSET_PATH, []);

    expect(result.some(s => s.includes('article'))).toBe(true);
  });

  it('includes shared chunk imports in the result', async () => {
    await writeManifestFixture(BASE_MANIFEST);
    const { getDependenciesNextForComponents } = require('./get-script-dependencies');

    const result = getDependenciesNextForComponents(['article'], ASSET_PATH, []);

    expect(result.some(s => s.includes('vendor-C3'))).toBe(true);
  });

  it('does not include chunks for components not on the page', async () => {
    await writeManifestFixture(BASE_MANIFEST);
    const { getDependenciesNextForComponents } = require('./get-script-dependencies');

    // Only request 'paragraph' — vendor chunk is only imported by 'article'
    const result = getDependenciesNextForComponents(['paragraph'], ASSET_PATH, []);

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
    const { getDependenciesNextForComponents } = require('./get-script-dependencies');

    const result = getDependenciesNextForComponents(['article', 'gallery'], ASSET_PATH, []);
    const sharedCount = result.filter(s => s.includes('shared-X')).length;

    expect(sharedCount).toBe(1);
  });

  it('skips component names that are not present in the manifest', async () => {
    await writeManifestFixture(BASE_MANIFEST);
    const { getDependenciesNextForComponents } = require('./get-script-dependencies');

    // 'missing-component' has no entry in the manifest
    const result = getDependenciesNextForComponents(
      ['article', 'missing-component'],
      ASSET_PATH,
      []
    );

    expect(result.some(s => s.includes('article'))).toBe(true);
    expect(result.some(s => s.includes('missing'))).toBe(false);
  });

  it('prepends _view-init bundle before any global scripts', async () => {
    const manifest = {
      ...BASE_MANIFEST,
      '.clay/_view-init': {
        file: '/js/.clay/_view-init-V1.js',
        imports: [],
      },
    };

    await writeManifestFixture(manifest);
    const { getDependenciesNextForComponents } = require('./get-script-dependencies');

    const result = getDependenciesNextForComponents(['article'], ASSET_PATH, ['global/js/aaa-module-mounting']);

    const viewInitIdx = result.findIndex(s => s.includes('_view-init'));
    const globalIdx   = result.findIndex(s => s.includes('aaa-module-mounting'));

    expect(viewInitIdx).toBeGreaterThanOrEqual(0);
    // _view-init must appear before any global scripts
    if (globalIdx !== -1) {
      expect(viewInitIdx).toBeLessThan(globalIdx);
    }
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

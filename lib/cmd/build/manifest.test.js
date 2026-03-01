'use strict';

const path = require('path');
const fs = require('fs-extra');
const os = require('os');
const { writeManifest } = require('./manifest');

// Use a real temporary directory so fs-extra works without mocking
let tmpDir;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'claycli-manifest-'));
});

afterEach(async () => {
  await fs.remove(tmpDir);
});

describe('writeManifest', () => {
  it('returns early when metafile is falsy', async () => {
    const result = await writeManifest(null, tmpDir);

    expect(result).toBeUndefined();
    const manifestPath = path.join(tmpDir, '_manifest.json');

    expect(fs.existsSync(manifestPath)).toBe(false);
  });

  it('returns early when metafile has no outputs', async () => {
    const result = await writeManifest({}, tmpDir);

    expect(result).toBeUndefined();
  });

  it('writes _manifest.json with correct entry keys and file URLs', async () => {
    const outFile = path.join(tmpDir, 'components', 'article', 'client-ABC123.js');

    await fs.ensureDir(path.dirname(outFile));

    const metafile = {
      outputs: {
        [outFile]: {
          entryPoint: './components/article/client.js',
          imports: [],
        },
      },
    };

    const manifest = await writeManifest(metafile, tmpDir, '/js');
    const written = await fs.readJson(path.join(tmpDir, '_manifest.json'));

    expect(manifest['components/article/client']).toBeDefined();
    expect(manifest['components/article/client'].file).toBe('/js/components/article/client-ABC123.js');
    expect(manifest['components/article/client'].imports).toEqual([]);
    expect(written).toEqual(manifest);
  });

  it('maps multiple entry points', async () => {
    const clientFile = path.join(tmpDir, 'components', 'article', 'client-A1.js');
    const modelFile  = path.join(tmpDir, 'components', 'article', 'model-B2.js');

    await fs.ensureDir(path.dirname(clientFile));

    const metafile = {
      outputs: {
        [clientFile]: { entryPoint: './components/article/client.js', imports: [] },
        [modelFile]:  { entryPoint: './components/article/model.js',  imports: [] },
      },
    };

    const manifest = await writeManifest(metafile, tmpDir, '/js');

    expect(Object.keys(manifest)).toHaveLength(2);
    expect(manifest['components/article/client']).toBeDefined();
    expect(manifest['components/article/model']).toBeDefined();
  });

  it('skips outputs that have no entryPoint (shared chunks)', async () => {
    const entryFile = path.join(tmpDir, 'components', 'article', 'client-A1.js');
    const chunkFile = path.join(tmpDir, 'chunks', 'vendor-C3.js');

    await fs.ensureDir(path.dirname(entryFile));
    await fs.ensureDir(path.dirname(chunkFile));

    const metafile = {
      outputs: {
        [entryFile]: { entryPoint: './components/article/client.js', imports: [] },
        [chunkFile]: { imports: [] }, // chunk — no entryPoint
      },
    };

    const manifest = await writeManifest(metafile, tmpDir, '/js');

    expect(Object.keys(manifest)).toHaveLength(1);
    expect(manifest['components/article/client']).toBeDefined();
  });

  it('includes chunk import URLs in the imports array', async () => {
    const entryFile = path.join(tmpDir, 'components', 'article', 'client-A1.js');
    const chunkFile = path.join(tmpDir, 'chunks', 'shared-C3.js');

    await fs.ensureDir(path.dirname(entryFile));
    await fs.ensureDir(path.dirname(chunkFile));

    const metafile = {
      outputs: {
        [entryFile]: {
          entryPoint: './components/article/client.js',
          imports: [{ path: chunkFile, kind: 'import-statement' }],
        },
        [chunkFile]: { imports: [] },
      },
    };

    const manifest = await writeManifest(metafile, tmpDir, '/js');

    expect(manifest['components/article/client'].imports).toContain('/js/chunks/shared-C3.js');
  });

  it('uses the provided publicBase prefix', async () => {
    const outFile = path.join(tmpDir, 'components', 'article', 'client-A1.js');

    await fs.ensureDir(path.dirname(outFile));

    const metafile = {
      outputs: {
        [outFile]: { entryPoint: './components/article/client.js', imports: [] },
      },
    };

    const manifest = await writeManifest(metafile, tmpDir, '/custom/assets');

    expect(manifest['components/article/client'].file).toMatch(/^\/custom\/assets\//);
  });

  it('strips leading ./ from entry point keys', async () => {
    const outFile = path.join(tmpDir, 'components', 'article', 'client-A1.js');

    await fs.ensureDir(path.dirname(outFile));

    const metafile = {
      outputs: {
        [outFile]: { entryPoint: './components/article/client.js', imports: [] },
      },
    };

    const manifest = await writeManifest(metafile, tmpDir, '/js');

    expect(Object.keys(manifest)[0]).toBe('components/article/client');
  });
});

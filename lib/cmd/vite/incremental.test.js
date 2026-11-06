/* eslint-env jest */
'use strict';

const fs = require('fs-extra');
const os = require('os');
const path = require('path');

let tmpDir, cwdSpy, incremental;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'claycli-vite-incremental-'));
  cwdSpy = jest.spyOn(process, 'cwd').mockReturnValue(tmpDir);
  jest.resetModules();
  incremental = require('./incremental');
});

afterEach(async () => {
  cwdSpy.mockRestore();
  await fs.remove(tmpDir);
  jest.resetModules();
});

/**
 * An index in the shape the build writes, for the choosePasses tests.
 *
 * @returns {object}
 */
function indexWith() {
  return {
    version: 1,
    view: { modules: ['components/nav/client.js', 'services/universal/utils.js'], files: ['chunks/a.js'] },
    kiln: { modules: ['components/nav/model.js', 'services/universal/utils.js'], files: ['.clay/k.js'] },
  };
}

describe('vite incremental', () => {
  describe('normalizeFile', () => {
    it('makes absolute and ./ paths project-relative with forward slashes', () => {
      expect(incremental.normalizeFile(path.join(tmpDir, 'components', 'nav', 'client.js'))).toBe('components/nav/client.js');
      expect(incremental.normalizeFile('./components/nav/client.js')).toBe('components/nav/client.js');
      expect(incremental.normalizeFile('components/nav/client.js')).toBe('components/nav/client.js');
    });
  });

  describe('projectModules', () => {
    it('keeps project files only, without virtual prefixes or queries', () => {
      const ids = [
        path.join(tmpDir, 'components/nav/client.js'),
        `\0${path.join(tmpDir, 'components/nav/client.js')}?commonjs-proxy`,
        path.join(tmpDir, 'services/universal/utils.js?x=1'),
        path.join(tmpDir, 'node_modules/lodash/lodash.js'),
        path.join(os.tmpdir(), 'elsewhere.js'),
        'virtual:module',
      ];

      expect(incremental.projectModules(ids)).toEqual(['components/nav/client.js', 'services/universal/utils.js']);
    });
  });

  describe('createModuleCollector', () => {
    it('records every module of the pass, including ones tree-shaken out', () => {
      const collector = incremental.createModuleCollector();
      const plugin = collector.plugin();

      plugin.buildEnd.call({ getModuleIds: () => [path.join(tmpDir, 'a.js'), path.join(tmpDir, 'b.js')].values() });

      expect(plugin.name).toBe('clay-vite-module-collector');
      expect(collector.modules()).toEqual(['a.js', 'b.js']);
    });
  });

  describe('describePass', () => {
    it('keeps the modules and the sorted file names of the output', () => {
      const output = { output: [{ fileName: 'chunks/b.js' }, { fileName: '.clay/a.js' }] };

      expect(incremental.describePass(output, ['x.js'])).toEqual({ modules: ['x.js'], files: ['.clay/a.js', 'chunks/b.js'] });
    });
  });

  describe('readIndex and writeIndex', () => {
    it('round-trips through .clay/vite-deps.json', () => {
      expect(incremental.readIndex()).toBe(null);
      expect(incremental.writeIndex({ view: { modules: [], files: [] } })).toBe(true);
      expect(incremental.readIndex()).toEqual({ version: 1, view: { modules: [], files: [] } });
      expect(fs.existsSync(path.join(tmpDir, '.clay', 'vite-deps.json'))).toBe(true);
    });

    it('ignores an index from another version or a broken one', async () => {
      await fs.outputJson(incremental.INDEX_FILE, { version: 99 });
      expect(incremental.readIndex()).toBe(null);
      await fs.outputFile(incremental.INDEX_FILE, '{nope');
      expect(incremental.readIndex()).toBe(null);
    });

    it('does not throw when the index cannot be written', async () => {
      await fs.outputFile(path.join(tmpDir, '.clay'), 'a file where the folder should be');
      expect(incremental.writeIndex({ view: {} })).toBe(false);
    });
  });

  describe('choosePasses', () => {
    it('rebuilds only the view pass for a file only the view pass bundled', () => {
      expect(incremental.choosePasses(['components/nav/client.js'], indexWith(), true)).toEqual(['view']);
    });

    it('rebuilds only the kiln pass for a file only the kiln pass bundled', () => {
      expect(incremental.choosePasses(['components/nav/model.js'], indexWith(), true)).toEqual(['kiln']);
    });

    it('rebuilds both for a shared file, or files from each', () => {
      expect(incremental.choosePasses(['services/universal/utils.js'], indexWith(), true)).toEqual(['view', 'kiln']);
      expect(incremental.choosePasses(['components/nav/client.js', 'components/nav/model.js'], indexWith(), true)).toEqual(['view', 'kiln']);
    });

    it('accepts absolute and ./ paths', () => {
      expect(incremental.choosePasses(['./components/nav/client.js', path.join(tmpDir, 'components/nav/client.js')], indexWith(), true)).toEqual(['view']);
    });

    it('rebuilds both when any file is unknown to both passes (a new file)', () => {
      expect(incremental.choosePasses(['components/nav/client.js', 'components/new/client.js'], indexWith(), true)).toEqual(['view', 'kiln']);
    });

    it('rebuilds both without a changed list, an index, a manifest, or a complete index', () => {
      expect(incremental.choosePasses(undefined, indexWith(), true)).toEqual(['view', 'kiln']);
      expect(incremental.choosePasses([], indexWith(), true)).toEqual(['view', 'kiln']);
      expect(incremental.choosePasses(['components/nav/client.js'], null, true)).toEqual(['view', 'kiln']);
      expect(incremental.choosePasses(['components/nav/client.js'], indexWith(), false)).toEqual(['view', 'kiln']);
      expect(incremental.choosePasses(['components/nav/client.js'], { version: 1, view: indexWith().view }, true)).toEqual(['view', 'kiln']);
    });
  });

  describe('mergeManifest', () => {
    const kilnKey = '.clay/vite-kiln-edit-init';
    const existing = {
      '.clay/vite-bootstrap': { file: '/js/.clay/vite-bootstrap-old.js', imports: [] },
      'components/gone/client': { file: '/js/chunks/gone-old.js', imports: [] },
      [kilnKey]: { file: '/js/.clay/vite-kiln-edit-init-old.js', imports: [] },
    };

    it('replaces the view entries and keeps the kiln entry when only the view pass ran', () => {
      const fresh = { '.clay/vite-bootstrap': { file: '/js/.clay/vite-bootstrap-new.js', imports: [] } };

      expect(incremental.mergeManifest(existing, fresh, ['view'], kilnKey)).toEqual({
        [kilnKey]: existing[kilnKey],
        '.clay/vite-bootstrap': fresh['.clay/vite-bootstrap'],
      });
    });

    it('replaces the kiln entry and keeps the view entries when only the kiln pass ran', () => {
      const fresh = { [kilnKey]: { file: '/js/.clay/vite-kiln-edit-init-new.js', imports: [] } };

      expect(incremental.mergeManifest(existing, fresh, ['kiln'], kilnKey)).toEqual({
        '.clay/vite-bootstrap': existing['.clay/vite-bootstrap'],
        'components/gone/client': existing['components/gone/client'],
        [kilnKey]: fresh[kilnKey],
      });
    });

    it('handles a missing manifest', () => {
      expect(incremental.mergeManifest(null, { a: 1 }, ['view'], kilnKey)).toEqual({ a: 1 });
    });
  });

  describe('staleFiles and pruneStale', () => {
    it('lists the files neither pass wrote', () => {
      const onDisk = ['chunks/a.js', 'chunks/old.js', '.clay/k.js', '.clay/old-k.js'];

      expect(incremental.staleFiles(indexWith(), onDisk)).toEqual(['chunks/old.js', '.clay/old-k.js']);
    });

    it('lists nothing when a pass is unknown, so a half-known index never deletes live files', () => {
      expect(incremental.staleFiles({ version: 1, view: indexWith().view }, ['chunks/old.js'])).toEqual([]);
      expect(incremental.staleFiles(null, ['chunks/old.js'])).toEqual([]);
    });

    it('deletes stale files in chunks and .clay only, and leaves everything else', async () => {
      const dest = path.join(tmpDir, 'public', 'js');

      await Promise.all(['chunks/a.js', 'chunks/old.js', '.clay/k.js', '.clay/old-k.js', '_templates-a-d.js', '_manifest.json']
        .map(file => fs.outputFile(path.join(dest, file), 'x')));

      expect(await incremental.pruneStale(indexWith(), dest)).toBe(2);
      expect((await fs.readdir(path.join(dest, 'chunks'))).sort()).toEqual(['a.js']);
      expect((await fs.readdir(path.join(dest, '.clay'))).sort()).toEqual(['k.js']);
      expect(fs.existsSync(path.join(dest, '_templates-a-d.js'))).toBe(true);
      expect(fs.existsSync(path.join(dest, '_manifest.json'))).toBe(true);
    });

    it('copes with folders that do not exist', async () => {
      expect(await incremental.pruneStale(indexWith(), path.join(tmpDir, 'public', 'js'))).toBe(0);
    });
  });

  describe('unionEnvNames', () => {
    it('adds the lists, sorted and without duplicates', () => {
      expect(incremental.unionEnvNames(['B', 'A'], ['C', 'A'])).toEqual(['A', 'B', 'C']);
    });
  });
});

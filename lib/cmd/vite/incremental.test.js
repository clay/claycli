/* eslint-env jest */
'use strict';

const { execFileSync } = require('child_process');
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

const CONFIG = 'cfg-a';

/**
 * An index in the shape the build writes, for the choosePasses tests.
 *
 * @returns {object}
 */
function indexWith() {
  return {
    version: 1,
    config: CONFIG,
    passes: ['view', 'kiln'],
    view: { modules: ['components/nav/client.js', 'services/universal/utils.js'], files: ['chunks/a.js'], env: ['VIEW_VAR'] },
    kiln: { modules: ['components/nav/model.js', 'services/universal/utils.js'], files: ['.clay/k.js'], env: ['KILN_VAR'] },
  };
}

/**
 * Build a two-chunk project with Vite in a child process and return the output Rollup lists.
 *
 * @param {string} root - Project folder holding entry.js.
 * @param {string} out - Output folder.
 * @returns {object[]} The `output` array of the build result ({ fileName } for each item).
 */
function buildWithSourcemaps(root, out) {
  const script = `
    const vite = require('vite');
    const root = ${JSON.stringify(root)};

    vite.build({
      root,
      configFile: false,
      logLevel: 'silent',
      build: {
        write: true,
        outDir: ${JSON.stringify(out)},
        sourcemap: true,
        minify: false,
        rollupOptions: {
          input: { '.clay/entry': root + '/entry.js' },
          output: { format: 'esm', entryFileNames: '[name]-[hash].js', chunkFileNames: 'chunks/[name]-[hash].js' },
        },
      },
    }).then(result => console.log(JSON.stringify((Array.isArray(result) ? result[0] : result).output.map(item => ({ fileName: item.fileName })))));
  `;

  return JSON.parse(execFileSync(process.execPath, ['-e', script], {
    cwd: path.resolve(__dirname, '..', '..', '..'),
    encoding: 'utf8',
    env: { ...process.env, VITE_CJS_IGNORE_WARNING: 'true' },
    stdio: ['ignore', 'pipe', 'ignore'],
  }));
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
    it('keeps the modules, the sorted file names of the output and the sorted env names', () => {
      const output = { output: [{ fileName: 'chunks/b.js' }, { fileName: '.clay/a.js' }] };

      expect(incremental.describePass(output, ['x.js'], ['B', 'A', 'B'])).toEqual({ modules: ['x.js'], files: ['.clay/a.js', 'chunks/b.js'], env: ['A', 'B'] });
      expect(incremental.describePass(output, ['x.js']).env).toEqual([]);
    });

    // --clean keeps what the index lists, so a live chunk's sourcemap must be listed. This runs a real
    // Rollup build and checks that its output names the maps it writes. It runs in a child process:
    // Vite's CJS entry loads its ESM build with a dynamic import, which Jest's sandbox does not allow.
    it('lists the sourcemap files Rollup writes, so pruneStale never takes a live chunk\'s map for stale', async () => {
      const root = path.join(tmpDir, 'sourcemap-probe');
      const out = path.join(root, 'out');

      // The entry has to use the import, or Rollup drops it and leaves an empty chunk.
      await fs.outputFile(path.join(root, 'entry.js'), 'import("./lazy.js").then(module => console.log(module.lazy()));\n');
      await fs.outputFile(path.join(root, 'lazy.js'), 'export const lazy = () => 1;\n');

      const listed = buildWithSourcemaps(root, out);
      const view = incremental.describePass({ output: listed }, [], []);
      const maps = [...await fs.readdir(path.join(out, 'chunks')), ...await fs.readdir(path.join(out, '.clay'))].filter(name => name.endsWith('.js.map'));

      expect(maps.length).toBe(2);
      expect(view.files.filter(file => file.endsWith('.js.map')).length).toBe(2);
      expect(await incremental.pruneStale({ view, kiln: { files: [] } }, out)).toBe(0);
    });
  });

  describe('fingerprint', () => {
    it('is the same for equal configs whatever order the keys were set in', () => {
      expect(incremental.fingerprint({ a: 1, b: { c: [1, 2], d: 'x' } })).toBe(incremental.fingerprint({ b: { d: 'x', c: [1, 2] }, a: 1 }));
      expect(incremental.fingerprint({ a: 1 })).toMatch(/^[0-9a-f]{16}$/);
    });

    it('changes with a value, a function body or a pattern', () => {
      expect(incremental.fingerprint({ minify: false })).not.toBe(incremental.fingerprint({ minify: true }));
      expect(incremental.fingerprint({ hook: () => 1 })).not.toBe(incremental.fingerprint({ hook: () => 2 }));
      expect(incremental.fingerprint({ re: /a/ })).not.toBe(incremental.fingerprint({ re: /b/ }));
    });

    it('copes with a config that contains itself, and gives up on one that cannot be serialized', () => {
      const looped = { a: 1 };

      looped.self = looped;
      expect(incremental.fingerprint(looped)).toMatch(/^[0-9a-f]{16}$/);
      expect(incremental.fingerprint({ get boom() { throw new Error('cannot be read'); } })).toBe(null);
    });
  });

  describe('dependencyState', () => {
    const record = name => path.join(tmpDir, 'node_modules', name);

    it('hashes the record the package manager left in node_modules, and changes when it does', async () => {
      expect(incremental.dependencyState()).toBe(null);
      await fs.outputFile(record('.package-lock.json'), 'one');

      const first = incremental.dependencyState();

      expect(first).toMatch(/^[0-9a-f]{16}$/);
      await fs.outputFile(record('.package-lock.json'), 'two');
      expect(incremental.dependencyState()).not.toBe(first);
    });

    it('falls back to the Yarn and pnpm records', async () => {
      await fs.outputFile(record('.yarn-integrity'), 'yarn');

      const yarn = incremental.dependencyState();

      expect(yarn).toMatch(/^[0-9a-f]{16}$/);
      await fs.remove(record('.yarn-integrity'));
      await fs.outputFile(record('.modules.yaml'), 'pnpm');
      expect(incremental.dependencyState()).toMatch(/^[0-9a-f]{16}$/);
      expect(incremental.dependencyState()).not.toBe(yarn);
    });
  });

  describe('envNames', () => {
    it('is the sorted union of what each pass recorded, so a replaced pass drops its old names', () => {
      const index = indexWith();

      expect(incremental.envNames(index)).toEqual(['KILN_VAR', 'VIEW_VAR']);
      index.view.env = ['OTHER_VAR'];
      expect(incremental.envNames(index)).toEqual(['KILN_VAR', 'OTHER_VAR']);
    });

    it('copes with a pass that was not recorded', () => {
      expect(incremental.envNames({ view: { env: ['B', 'A'] } })).toEqual(['A', 'B']);
      expect(incremental.envNames({})).toEqual([]);
    });
  });

  describe('clearIndex', () => {
    it('removes the index, and copes with there being none', () => {
      incremental.writeIndex({ view: { modules: [], files: [] } });
      incremental.clearIndex();
      expect(incremental.readIndex()).toBe(null);
      expect(fs.existsSync(incremental.INDEX_FILE)).toBe(false);
      expect(() => incremental.clearIndex()).not.toThrow();
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
    const choose = (changed, index = indexWith(), hasManifest = true, config = CONFIG) => incremental.choosePasses(changed, index, hasManifest, config);

    it('rebuilds only the view pass for a file only the view pass bundled', () => {
      expect(choose(['components/nav/client.js'])).toEqual(['view']);
    });

    it('rebuilds only the kiln pass for a file only the kiln pass bundled', () => {
      expect(choose(['components/nav/model.js'])).toEqual(['kiln']);
    });

    it('rebuilds both for a shared file, or files from each', () => {
      expect(choose(['services/universal/utils.js'])).toEqual(['view', 'kiln']);
      expect(choose(['components/nav/client.js', 'components/nav/model.js'])).toEqual(['view', 'kiln']);
    });

    it('accepts absolute and ./ paths', () => {
      expect(choose(['./components/nav/client.js', path.join(tmpDir, 'components/nav/client.js')])).toEqual(['view']);
    });

    it('rebuilds both when any file is unknown to both passes (a new file)', () => {
      expect(choose(['components/nav/client.js', 'components/new/client.js'])).toEqual(['view', 'kiln']);
    });

    it('rebuilds both without a changed list, an index, a manifest, or a complete index', () => {
      expect(choose(undefined)).toEqual(['view', 'kiln']);
      expect(choose([])).toEqual(['view', 'kiln']);
      expect(choose(['components/nav/client.js'], null)).toEqual(['view', 'kiln']);
      expect(choose(['components/nav/client.js'], indexWith(), false)).toEqual(['view', 'kiln']);
      expect(choose(['components/nav/client.js'], { version: 1, config: CONFIG, view: indexWith().view })).toEqual(['view', 'kiln']);
    });

    it('rebuilds both when the build config differs from the one the index was written under', () => {
      expect(choose(['components/nav/client.js'], indexWith(), true, 'cfg-b')).toEqual(['view', 'kiln']);
      expect(choose(['components/nav/client.js'], indexWith(), true, null)).toEqual(['view', 'kiln']);
      expect(choose(['components/nav/client.js'], { ...indexWith(), config: undefined })).toEqual(['view', 'kiln']);
    });

    it('rebuilds both when a pass has no env names recorded, as in an index from before they were kept', () => {
      const index = indexWith();

      delete index.kiln.env;
      expect(choose(['components/nav/client.js'], index)).toEqual(['view', 'kiln']);
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
      expect(incremental.staleFiles({ version: 1, passes: ['view', 'kiln'], view: indexWith().view }, ['chunks/old.js'])).toEqual([]);
      expect(incremental.staleFiles({ version: 1, passes: [], view: indexWith().view }, ['chunks/old.js'])).toEqual([]);
      expect(incremental.staleFiles(null, ['chunks/old.js'])).toEqual([]);
    });

    it('lists the stale files when the index says one pass is the whole build, as under kilnSplit', () => {
      const index = { version: 1, passes: ['view'], view: indexWith().view };

      expect(incremental.staleFiles(index, ['chunks/a.js', 'chunks/old.js', '.clay/old-k.js'])).toEqual(['chunks/old.js', '.clay/old-k.js']);
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
});

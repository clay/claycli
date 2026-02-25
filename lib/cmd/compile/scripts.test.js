'use strict';

const path = require('path'),
  helpers = require('../../compilation-helpers');

// scripts.js has heavy deps (browserify, etc.) that are loaded at require time.
// We require it once and test the exported internal functions.
const scripts = require('./scripts');

describe('compile/scripts', () => {
  const cwd = process.cwd(),
    destPath = path.resolve(cwd, 'public', 'js');

  describe('getModuleId', () => {
    const fn = scripts.getModuleId;

    it('returns <name>.client for component client.js files', () => {
      const file = path.resolve(cwd, 'components', 'my-component', 'client.js');

      expect(fn(file, [])).toBe('my-component.client');
    });

    it('returns <name>.model for component model.js files', () => {
      const file = path.resolve(cwd, 'components', 'my-component', 'model.js');

      expect(fn(file, [])).toBe('my-component.model');
    });

    it('returns <name>.kiln for component kiln.js files', () => {
      const file = path.resolve(cwd, 'components', 'my-component', 'kiln.js');

      expect(fn(file, [])).toBe('my-component.kiln');
    });

    it('returns <folder>_<name>.kilnplugin for kiln plugin files', () => {
      const file = path.resolve(cwd, 'services', 'kiln', 'plugins', 'kiln-tracking.js');

      expect(fn(file, [])).toBe('plugins_kiln-tracking.kilnplugin');
    });

    it('returns <folder>_<name>.kilnplugin for kiln plugin index', () => {
      const file = path.resolve(cwd, 'services', 'kiln', 'index.js');

      expect(fn(file, [])).toBe('kiln_index.kilnplugin');
    });

    it('returns <name>.legacy for legacy files', () => {
      const file = '/some/path/to/legacy-lib.js';

      expect(fn(file, [file])).toBe('legacy-lib.legacy');
    });

    it('returns undefined for files not in components, not kiln plugins, not legacy', () => {
      const file = '/some/random/path/to/dependency.js';

      expect(fn(file, [])).toBeUndefined();
    });

    it('returns undefined for component files that are not client/model/kiln', () => {
      const file = path.resolve(cwd, 'components', 'my-component', 'helper.js');

      expect(fn(file, [])).toBeUndefined();
    });

    it('uses the parent directory name as the component name', () => {
      const file = path.resolve(cwd, 'components', 'article-header', 'client.js');

      expect(fn(file, [])).toBe('article-header.client');
    });

    it('handles deeply nested component paths', () => {
      // The function uses file.split('/').slice(-2)[0] to get the parent dir
      const file = path.resolve(cwd, 'components', 'nested', 'deep', 'client.js');

      expect(fn(file, [])).toBe('deep.client');
    });
  });

  describe('idGenerator', () => {
    const fn = scripts.idGenerator;

    it('returns a function', () => {
      const generator = fn({ cachedIds: {}, legacyFiles: [] });

      expect(typeof generator).toBe('function');
    });

    it('returns named ID for component files', () => {
      const generator = fn({ cachedIds: {}, legacyFiles: [] }),
        file = path.resolve(cwd, 'components', 'my-comp', 'client.js');

      expect(generator(file)).toBe('my-comp.client');
    });

    it('returns incrementing numeric IDs for non-component files', () => {
      const generator = fn({ cachedIds: {}, legacyFiles: [] });

      expect(generator('/some/dep-a.js')).toBe(1);
      expect(generator('/some/dep-b.js')).toBe(2);
      expect(generator('/some/dep-c.js')).toBe(3);
    });

    it('returns cached IDs when provided', () => {
      const cachedIds = { '/some/file.js': 42 },
        generator = fn({ cachedIds, legacyFiles: [] });

      expect(generator('/some/file.js')).toBe(42);
    });

    it('starts numeric IDs after the highest cached numeric ID', () => {
      const cachedIds = { '/some/file.js': 10, '/other/file.js': 'my-comp.client' },
        generator = fn({ cachedIds, legacyFiles: [] });

      // New non-component file should get 11 (one more than highest numeric cached ID)
      expect(generator('/new/dep.js')).toBe(11);
    });

    it('returns same ID for same file on repeated calls', () => {
      const generator = fn({ cachedIds: {}, legacyFiles: [] }),
        file = '/some/dep.js';

      expect(generator(file)).toBe(1);
      expect(generator(file)).toBe(1); // same ID, not 2
    });

    it('populates temporaryIDs as a side effect', () => {
      const generator = fn({ cachedIds: {}, legacyFiles: [] }),
        file = '/some/dep.js';

      generator(file);
      expect(scripts._temporaryIDs[1]).toBe(file);
    });
  });

  describe('getOutfile', () => {
    const fn = scripts.getOutfile;

    it('returns _prelude.js for prelude ID', () => {
      expect(fn({ id: 'prelude' })).toBe(path.join(destPath, '_prelude.js'));
    });

    it('returns _postlude.js for postlude ID', () => {
      expect(fn({ id: 'postlude' })).toBe(path.join(destPath, '_postlude.js'));
    });

    it('returns _kiln-plugins.js for kilnplugin IDs', () => {
      expect(fn({ id: 'plugins_tracking.kilnplugin' })).toBe(path.join(destPath, '_kiln-plugins.js'));
    });

    it('returns [_global.js, <name>.legacy.js] for legacy IDs', () => {
      const result = fn({ id: 'jquery.legacy' });

      expect(result).toEqual([
        path.join(destPath, '_global.js'),
        path.join(destPath, 'jquery.legacy.js')
      ]);
    });

    it('returns [<name>.model.js, _models-<bucket>.js] for model IDs', () => {
      const result = fn({ id: 'article.model' });

      expect(result).toEqual([
        path.join(destPath, 'article.model.js'),
        path.join(destPath, `_models-${helpers.bucket('article.model')}.js`)
      ]);
    });

    it('buckets model files alphabetically', () => {
      // 'article' starts with 'a' → bucket 'a-d'
      const result = fn({ id: 'article.model' });

      expect(result[1]).toBe(path.join(destPath, '_models-a-d.js'));
    });

    it('returns [<name>.kiln.js, _kiln-<bucket>.js] for kiln IDs', () => {
      const result = fn({ id: 'my-comp.kiln' });

      expect(result).toEqual([
        path.join(destPath, 'my-comp.kiln.js'),
        path.join(destPath, `_kiln-${helpers.bucket('my-comp.kiln')}.js`)
      ]);
    });

    it('returns [<id>.js, _deps-<bucket>.js] for numeric dependency IDs', () => {
      // First, populate temporaryIDs via idGenerator
      const generator = scripts.idGenerator({ cachedIds: {}, legacyFiles: [] }),
        depFile = '/some/path/to/helper.js',
        id = generator(depFile),
        result = fn({ id });

      expect(result).toEqual([
        path.join(destPath, `${id}.js`),
        path.join(destPath, `_deps-${helpers.bucket('helper')}.js`)
      ]);
    });

    it('returns <name>.client.js for client IDs (no bucketing)', () => {
      expect(fn({ id: 'my-comp.client' })).toBe(path.join(destPath, 'my-comp.client.js'));
    });

    it('returns <id>.js for unrecognized string IDs', () => {
      expect(fn({ id: 'something-else' })).toBe(path.join(destPath, 'something-else.js'));
    });
  });

  describe('bucket splitting patterns', () => {
    const fn = scripts.getOutfile;

    it('buckets a-d names into _models-a-d.js', () => {
      expect(fn({ id: 'alpha.model' })[1]).toContain('_models-a-d.js');
      expect(fn({ id: 'bravo.model' })[1]).toContain('_models-a-d.js');
      expect(fn({ id: 'charlie.model' })[1]).toContain('_models-a-d.js');
      expect(fn({ id: 'delta.model' })[1]).toContain('_models-a-d.js');
    });

    it('buckets e-h names into _models-e-h.js', () => {
      expect(fn({ id: 'echo.model' })[1]).toContain('_models-e-h.js');
      expect(fn({ id: 'foxtrot.model' })[1]).toContain('_models-e-h.js');
      expect(fn({ id: 'golf.model' })[1]).toContain('_models-e-h.js');
      expect(fn({ id: 'hotel.model' })[1]).toContain('_models-e-h.js');
    });

    it('buckets i-l names into _models-i-l.js', () => {
      expect(fn({ id: 'india.model' })[1]).toContain('_models-i-l.js');
      expect(fn({ id: 'lima.model' })[1]).toContain('_models-i-l.js');
    });

    it('buckets m-p names into _models-m-p.js', () => {
      expect(fn({ id: 'mike.model' })[1]).toContain('_models-m-p.js');
      expect(fn({ id: 'papa.model' })[1]).toContain('_models-m-p.js');
    });

    it('buckets q-t names into _models-q-t.js', () => {
      expect(fn({ id: 'quebec.model' })[1]).toContain('_models-q-t.js');
      expect(fn({ id: 'tango.model' })[1]).toContain('_models-q-t.js');
    });

    it('buckets u-z names into _models-u-z.js', () => {
      expect(fn({ id: 'uniform.model' })[1]).toContain('_models-u-z.js');
      expect(fn({ id: 'zulu.model' })[1]).toContain('_models-u-z.js');
    });

    it('applies same bucketing to kiln files', () => {
      expect(fn({ id: 'alpha.kiln' })[1]).toContain('_kiln-a-d.js');
      expect(fn({ id: 'mike.kiln' })[1]).toContain('_kiln-m-p.js');
    });
  });

  describe('compile (main export)', () => {
    it('is a function', () => {
      expect(typeof scripts).toBe('function');
    });

    it('exports getDependencies', () => {
      expect(typeof scripts.getDependencies).toBe('function');
    });
  });

  describe('module ID assignment and output file mapping integration', () => {
    it('maps component client.js → single output file (no bucketing)', () => {
      const file = path.resolve(cwd, 'components', 'tags', 'client.js'),
        generator = scripts.idGenerator({ cachedIds: {}, legacyFiles: [] }),
        id = generator(file),
        outfile = scripts.getOutfile({ id });

      expect(id).toBe('tags.client');
      expect(outfile).toBe(path.join(destPath, 'tags.client.js'));
    });

    it('maps component model.js → individual + bucket file', () => {
      const file = path.resolve(cwd, 'components', 'tags', 'model.js'),
        generator = scripts.idGenerator({ cachedIds: {}, legacyFiles: [] }),
        id = generator(file),
        outfile = scripts.getOutfile({ id });

      expect(id).toBe('tags.model');
      expect(outfile).toEqual([
        path.join(destPath, 'tags.model.js'),
        path.join(destPath, '_models-q-t.js')
      ]);
    });

    it('maps component kiln.js → individual + bucket file', () => {
      const file = path.resolve(cwd, 'components', 'footer', 'kiln.js'),
        generator = scripts.idGenerator({ cachedIds: {}, legacyFiles: [] }),
        id = generator(file),
        outfile = scripts.getOutfile({ id });

      expect(id).toBe('footer.kiln');
      expect(outfile).toEqual([
        path.join(destPath, 'footer.kiln.js'),
        path.join(destPath, '_kiln-e-h.js')
      ]);
    });

    it('maps kiln plugin → _kiln-plugins.js', () => {
      const file = path.resolve(cwd, 'services', 'kiln', 'plugins', 'tracking.js'),
        generator = scripts.idGenerator({ cachedIds: {}, legacyFiles: [] }),
        id = generator(file),
        outfile = scripts.getOutfile({ id });

      expect(id).toBe('plugins_tracking.kilnplugin');
      expect(outfile).toBe(path.join(destPath, '_kiln-plugins.js'));
    });

    it('maps legacy file → _global.js + individual legacy file', () => {
      const file = '/some/path/to/dollar-slice.js',
        generator = scripts.idGenerator({ cachedIds: {}, legacyFiles: [file] }),
        id = generator(file),
        outfile = scripts.getOutfile({ id });

      expect(id).toBe('dollar-slice.legacy');
      expect(outfile).toEqual([
        path.join(destPath, '_global.js'),
        path.join(destPath, 'dollar-slice.legacy.js')
      ]);
    });

    it('maps dependency file → <number>.js + _deps-<bucket>.js', () => {
      const file = '/some/path/to/node_modules/some-lib/index.js',
        generator = scripts.idGenerator({ cachedIds: {}, legacyFiles: [] }),
        id = generator(file),
        outfile = scripts.getOutfile({ id });

      expect(typeof id).toBe('number');
      expect(outfile[0]).toBe(path.join(destPath, `${id}.js`));
      expect(outfile[1]).toContain('_deps-');
    });
  });

  describe('cache behavior', () => {
    it('preserves cached IDs across generator instances', () => {
      // First run builds the cache
      const cachedIds = {},
        gen1 = scripts.idGenerator({ cachedIds, legacyFiles: [] }),
        compFile = path.resolve(cwd, 'components', 'test', 'client.js');

      gen1(compFile);
      gen1('/dep/a.js');
      gen1('/dep/b.js');

      // cachedIds is mutated by the generator (assign behavior)
      // Second generator should reuse the same IDs
      const gen2 = scripts.idGenerator({ cachedIds, legacyFiles: [] });

      expect(gen2(compFile)).toBe('test.client');
      expect(gen2('/dep/a.js')).toBe(1);
      expect(gen2('/dep/b.js')).toBe(2);
    });

    it('continues incrementing after cached numeric IDs', () => {
      const cachedIds = { '/dep/a.js': 5, '/dep/b.js': 10 },
        gen = scripts.idGenerator({ cachedIds, legacyFiles: [] });

      // New dep should get 11 (max cached numeric + 1)
      expect(gen('/dep/new.js')).toBe(11);
    });
  });

  describe('output destination paths', () => {
    it('uses public/js as the destination for scripts', () => {
      expect(scripts._destPath).toBe(path.resolve(cwd, 'public', 'js'));
    });

    it('all output files are under public/js', () => {
      const testIds = [
        { id: 'prelude' },
        { id: 'postlude' },
        { id: 'foo.kilnplugin' },
        { id: 'bar.legacy' },
        { id: 'baz.model' },
        { id: 'qux.kiln' },
        { id: 'quux.client' }
      ];

      testIds.forEach((dep) => {
        const result = scripts.getOutfile(dep);

        if (Array.isArray(result)) {
          result.forEach((p) => expect(p).toContain(path.join('public', 'js'))); // eslint-disable-line max-nested-callbacks
        } else {
          expect(result).toContain(path.join('public', 'js'));
        }
      });
    });
  });

  describe('rewriteServiceRequire', () => {
    it('is a function', () => {
      expect(typeof scripts.rewriteServiceRequire).toBe('function');
    });

    it('does not modify non-server-service resource requests', () => {
      // rewriteServiceRequire is a Webpack NormalModuleReplacementPlugin callback
      var nonServerResource = { request: '../utils/helper', context: process.cwd() };

      scripts.rewriteServiceRequire(nonServerResource);
      expect(nonServerResource.request).toBe('../utils/helper');
    });
  });
});

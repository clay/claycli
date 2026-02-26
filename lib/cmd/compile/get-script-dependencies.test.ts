const path = require('path'),
  mockFs = require('mock-fs'),
  lib = require('./get-script-dependencies');

describe('get-script-dependencies', () => {
  const cwd = process.cwd(),
    destPath = path.resolve(cwd, 'public', 'js');

  afterEach(() => {
    mockFs.restore();
  });

  describe('idToPublicPath', () => {
    const fn = lib.idToPublicPath;

    it('converts module ID to public path with asset path', () => {
      expect(fn('foo', '/site-path')).toBe('/site-path/js/foo.js');
    });

    it('converts module ID to public path without asset path', () => {
      expect(fn('foo')).toBe('/js/foo.js');
    });

    it('converts module ID with empty asset path', () => {
      expect(fn('foo', '')).toBe('/js/foo.js');
    });

    it('handles complex module IDs', () => {
      expect(fn('article-header.client', '/media')).toBe('/media/js/article-header.client.js');
    });

    it('handles _prelude', () => {
      expect(fn('_prelude', '/site')).toBe('/site/js/_prelude.js');
    });

    it('handles _postlude', () => {
      expect(fn('_postlude', '/site')).toBe('/site/js/_postlude.js');
    });

    it('handles _client-init', () => {
      expect(fn('_client-init', '/site')).toBe('/site/js/_client-init.js');
    });

    it('handles _kiln-plugins', () => {
      expect(fn('_kiln-plugins', '/site')).toBe('/site/js/_kiln-plugins.js');
    });

    it('handles bucket file names', () => {
      expect(fn('_models-a-d', '/site')).toBe('/site/js/_models-a-d.js');
    });
  });

  describe('publicPathToID', () => {
    const fn = lib.publicPathToID;

    it('extracts module ID from full URL path', () => {
      expect(fn('https://localhost.cache.com/media/js/tags.client.js')).toBe('tags.client');
    });

    it('extracts module ID from relative path', () => {
      expect(fn('/media/js/article-header.model.js')).toBe('article-header.model');
    });

    it('handles simple filename', () => {
      expect(fn('foo.js')).toBe('foo');
    });

    it('handles bucket file names', () => {
      expect(fn('/media/js/_models-a-d.js')).toBe('_models-a-d');
    });

    it('handles numeric dependency IDs', () => {
      expect(fn('/media/js/42.js')).toBe('42');
    });

    it('handles _prelude path', () => {
      expect(fn('/site/js/_prelude.js')).toBe('_prelude');
    });

    it('handles legacy file paths', () => {
      expect(fn('/site/js/dollar-slice.legacy.js')).toBe('dollar-slice.legacy');
    });
  });

  describe('computeDep', () => {
    const fn = lib.computeDep;

    it('adds dep to out object', () => {
      var out = {},
        registry = { foo: [] };

      fn('foo', out, registry);
      expect(out).toEqual({ foo: true });
    });

    it('recursively adds dependencies', () => {
      var out = {},
        registry = {
          foo: ['bar', 'baz'],
          bar: [],
          baz: ['qux'],
          qux: []
        };

      fn('foo', out, registry);
      expect(out).toEqual({
        foo: true,
        bar: true,
        baz: true,
        qux: true
      });
    });

    it('does not revisit already-resolved deps (handles cycles)', () => {
      var out = {},
        registry = {
          foo: ['bar'],
          bar: ['foo'] // circular
        };

      fn('foo', out, registry);
      expect(out).toEqual({ foo: true, bar: true });
    });

    it('throws when dep is not in registry', () => {
      var out = {},
        registry = {};

      expect(() => fn('missing', out, registry)).toThrow(
        'Dependency Error: "missing" not found in registry'
      );
    });

    it('throws when nested dep is not in registry', () => {
      var out = {},
        registry = {
          foo: ['missing']
        };

      expect(() => fn('foo', out, registry)).toThrow(
        'Dependency Error: "missing" not found in registry'
      );
    });

    it('skips already-resolved deps', () => {
      var out = { foo: true },
        registry = { foo: ['bar'], bar: [] };

      fn('foo', out, registry);
      // bar should NOT be added since foo was already resolved
      expect(out).toEqual({ foo: true });
    });
  });

  describe('getAllDeps', () => {
    const fn = lib.getAllDeps;

    it('returns bucket file names when minified', () => {
      var fsConfig: Record<string, any> = {},
        result;

      fsConfig[path.join(destPath, '_deps-a-d.js')] = '';
      fsConfig[path.join(destPath, '_deps-e-h.js')] = '';
      fsConfig[path.join(destPath, '_deps-i-l.js')] = '';
      mockFs(fsConfig);

      result = fn(true);

      expect(result).toEqual(expect.arrayContaining(['_deps-a-d', '_deps-e-h', '_deps-i-l']));
      expect(result).toHaveLength(3);
    });

    it('returns numeric file names when not minified', () => {
      var fsConfig: Record<string, any> = {},
        result;

      fsConfig[path.join(destPath, '1.js')] = '';
      fsConfig[path.join(destPath, '2.js')] = '';
      fsConfig[path.join(destPath, '42.js')] = '';
      // non-numeric should not match
      fsConfig[path.join(destPath, 'foo.client.js')] = '';
      mockFs(fsConfig);

      result = fn(false);

      expect(result).toEqual(expect.arrayContaining(['1', '2', '42']));
      expect(result).not.toContain('foo.client');
    });

    it('returns empty array when no deps exist', () => {
      var fsConfig: Record<string, any> = {};

      fsConfig[destPath] = {};
      mockFs(fsConfig);
      expect(fn(true)).toEqual([]);
      expect(fn(false)).toEqual([]);
    });
  });

  describe('getAllModels', () => {
    const fn = lib.getAllModels;

    it('returns bucket file names when minified', () => {
      var fsConfig: Record<string, any> = {},
        result;

      fsConfig[path.join(destPath, '_models-a-d.js')] = '';
      fsConfig[path.join(destPath, '_models-m-p.js')] = '';
      mockFs(fsConfig);

      result = fn(true);

      expect(result).toEqual(expect.arrayContaining(['_models-a-d', '_models-m-p']));
    });

    it('returns individual model file names when not minified', () => {
      var fsConfig: Record<string, any> = {},
        result;

      fsConfig[path.join(destPath, 'article.model.js')] = '';
      fsConfig[path.join(destPath, 'tags.model.js')] = '';
      fsConfig[path.join(destPath, 'foo.client.js')] = '';
      mockFs(fsConfig);

      result = fn(false);

      expect(result).toEqual(expect.arrayContaining(['article.model', 'tags.model']));
      expect(result).not.toContain('foo.client');
    });
  });

  describe('getAllKilnjs', () => {
    const fn = lib.getAllKilnjs;

    it('returns bucket file names when minified', () => {
      var fsConfig: Record<string, any> = {},
        result;

      fsConfig[path.join(destPath, '_kiln-a-d.js')] = '';
      fsConfig[path.join(destPath, '_kiln-e-h.js')] = '';
      mockFs(fsConfig);

      result = fn(true);

      expect(result).toEqual(expect.arrayContaining(['_kiln-a-d', '_kiln-e-h']));
    });

    it('returns individual kiln file names when not minified', () => {
      var fsConfig: Record<string, any> = {},
        result;

      fsConfig[path.join(destPath, 'footer.kiln.js')] = '';
      fsConfig[path.join(destPath, 'header.kiln.js')] = '';
      mockFs(fsConfig);

      result = fn(false);

      expect(result).toEqual(expect.arrayContaining(['footer.kiln', 'header.kiln']));
    });
  });

  describe('getAllTemplates', () => {
    const fn = lib.getAllTemplates;

    it('returns bucket file names when minified', () => {
      var fsConfig: Record<string, any> = {},
        result;

      fsConfig[path.join(destPath, '_templates-a-d.js')] = '';
      fsConfig[path.join(destPath, '_templates-q-t.js')] = '';
      mockFs(fsConfig);

      result = fn(true);

      expect(result).toEqual(expect.arrayContaining(['_templates-a-d', '_templates-q-t']));
    });

    it('returns individual template file names when not minified', () => {
      var fsConfig: Record<string, any> = {},
        result;

      fsConfig[path.join(destPath, 'article.template.js')] = '';
      fsConfig[path.join(destPath, 'sidebar.template.js')] = '';
      mockFs(fsConfig);

      result = fn(false);

      expect(result).toEqual(expect.arrayContaining(['article.template', 'sidebar.template']));
    });
  });

  describe('getDependencies', () => {
    const fn = lib.getDependencies;

    describe('edit mode', () => {
      it('returns flattened array of all edit-mode scripts with asset path', () => {
        var fsConfig: Record<string, any> = {},
          result;

        // Create deps, models, kiln, templates
        fsConfig[path.join(destPath, '_deps-a-d.js')] = '';
        fsConfig[path.join(destPath, '_models-a-d.js')] = '';
        fsConfig[path.join(destPath, '_kiln-a-d.js')] = '';
        fsConfig[path.join(destPath, '_templates-a-d.js')] = '';
        mockFs(fsConfig);

        result = fn([], '/site', { edit: true, minify: true });

        // Should start with _prelude and end with _postlude
        expect(result[0]).toBe('/site/js/_prelude.js');
        expect(result[result.length - 1]).toBe('/site/js/_postlude.js');
        // Should include _kiln-plugins before _postlude
        expect(result[result.length - 2]).toBe('/site/js/_kiln-plugins.js');
      });

      it('includes deps, models, kiln, templates, and kiln-plugins in edit mode', () => {
        var fsConfig: Record<string, any> = {},
          result;

        fsConfig[path.join(destPath, '_deps-a-d.js')] = '';
        fsConfig[path.join(destPath, '_models-e-h.js')] = '';
        fsConfig[path.join(destPath, '_kiln-i-l.js')] = '';
        fsConfig[path.join(destPath, '_templates-m-p.js')] = '';
        mockFs(fsConfig);

        result = fn([], '/site', { edit: true, minify: true });

        expect(result).toContain('/site/js/_deps-a-d.js');
        expect(result).toContain('/site/js/_models-e-h.js');
        expect(result).toContain('/site/js/_kiln-i-l.js');
        expect(result).toContain('/site/js/_templates-m-p.js');
        expect(result).toContain('/site/js/_kiln-plugins.js');
      });

      it('edit mode order: _prelude, deps, models, kilnjs, templates, _kiln-plugins, _postlude', () => {
        var fsConfig: Record<string, any> = {},
          result, preludeIdx, depsIdx, modelsIdx, kilnIdx, templatesIdx, kilnPluginsIdx, postludeIdx;

        fsConfig[path.join(destPath, '1.js')] = '';
        fsConfig[path.join(destPath, 'article.model.js')] = '';
        fsConfig[path.join(destPath, 'footer.kiln.js')] = '';
        fsConfig[path.join(destPath, 'article.template.js')] = '';
        mockFs(fsConfig);

        result = fn([], '/site', { edit: true, minify: false });

        preludeIdx = result.indexOf('/site/js/_prelude.js');
        depsIdx = result.indexOf('/site/js/1.js');
        modelsIdx = result.indexOf('/site/js/article.model.js');
        kilnIdx = result.indexOf('/site/js/footer.kiln.js');
        templatesIdx = result.indexOf('/site/js/article.template.js');
        kilnPluginsIdx = result.indexOf('/site/js/_kiln-plugins.js');
        postludeIdx = result.indexOf('/site/js/_postlude.js');

        expect(preludeIdx).toBeLessThan(depsIdx);
        expect(depsIdx).toBeLessThan(modelsIdx);
        expect(modelsIdx).toBeLessThan(kilnIdx);
        expect(kilnIdx).toBeLessThan(templatesIdx);
        expect(templatesIdx).toBeLessThan(kilnPluginsIdx);
        expect(kilnPluginsIdx).toBeLessThan(postludeIdx);
      });

      it('does not include _client-init in edit mode', () => {
        var fsConfig: Record<string, any> = {},
          result;

        fsConfig[destPath] = {};
        mockFs(fsConfig);

        result = fn([], '/site', { edit: true });

        expect(result).not.toContain('/site/js/_client-init.js');
      });
    });

    describe('view mode', () => {
      it('returns _prelude, computed deps, _postlude, _client-init and includes legacy deps', () => {
        var registryPath = path.resolve(destPath, '_registry.json'),
          fsExtra = require('fs-extra'),
          result,
          registry = {
            'tags.client': [1, 2],
            1: [],
            2: [3],
            3: [],
            'jquery.legacy': [4],
            4: []
          };

        fsExtra.ensureDirSync(destPath);
        fsExtra.writeJsonSync(registryPath, registry);

        // Clear all _registry.json entries from require cache
        // eslint-disable-next-line max-nested-callbacks
        Object.keys(require.cache).forEach(function (key) {
          if (key.indexOf('_registry.json') !== -1) {
            delete require.cache[key];
          }
        });

        result = fn(
          ['/media/js/tags.client.js'],
          '/media',
          { edit: false }
        );

        // Starts with _prelude
        expect(result[0]).toBe('/media/js/_prelude.js');
        // Ends with _client-init, preceded by _postlude
        expect(result[result.length - 1]).toBe('/media/js/_client-init.js');
        expect(result[result.length - 2]).toBe('/media/js/_postlude.js');

        // Should contain the resolved deps for tags.client
        expect(result).toContain('/media/js/tags.client.js');
        expect(result).toContain('/media/js/1.js');
        expect(result).toContain('/media/js/2.js');
        expect(result).toContain('/media/js/3.js');

        // Legacy deps should be auto-included
        expect(result).toContain('/media/js/jquery.legacy.js');
        expect(result).toContain('/media/js/4.js');

        // Clean up
        fsExtra.removeSync(destPath);
        // eslint-disable-next-line max-nested-callbacks
        Object.keys(require.cache).forEach(function (key) {
          if (key.indexOf('_registry.json') !== -1) {
            delete require.cache[key];
          }
        });
      });
    });

    describe('asset path handling', () => {
      it('prepends asset path to all generated URLs', () => {
        var fsConfig: Record<string, any> = {},
          result;

        fsConfig[destPath] = {};
        mockFs(fsConfig);

        result = fn([], '/my-site/assets', { edit: true });

        // eslint-disable-next-line max-nested-callbacks
        result.forEach((url: any) => {
          expect(url).toMatch(/^\/my-site\/assets\/js\//);
        });
      });

      it('works with empty asset path', () => {
        var fsConfig: Record<string, any> = {},
          result;

        fsConfig[destPath] = {};
        mockFs(fsConfig);

        result = fn([], '', { edit: true });

        // eslint-disable-next-line max-nested-callbacks
        result.forEach((url: any) => {
          expect(url).toMatch(/^\/js\//);
        });
      });
    });
  });
});

export {};

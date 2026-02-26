'use strict';

// Mock VueLoaderPlugin — vue-template-compiler is a peer dep only available
// in consuming projects (e.g., nymag/sites), not in claycli's own node_modules.
// Contract tests run buildScripts() which needs the plugin to instantiate, but
// our fixture has no .vue files so a no-op plugin suffices.
jest.mock('vue-loader', () => ({
  VueLoaderPlugin: class VueLoaderPlugin {
    apply() {}
  }
}));

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

    it('rewrites services/server/<name> to services/client/<name>', () => {
      var fs = require('fs-extra'),
        tmpDir = path.resolve(process.cwd(), '_test-services-rewrite'),
        clientDir = path.join(tmpDir, 'services', 'client'),
        componentDir = path.join(tmpDir, 'components', 'article'),
        resource = {
          request: '../../services/server/foo',
          context: componentDir
        };

      try {
        fs.ensureDirSync(clientDir);
        fs.writeFileSync(path.join(clientDir, 'foo.js'), 'module.exports = {};');
        fs.ensureDirSync(componentDir);

        scripts.rewriteServiceRequire(resource);
        expect(resource.request).toBe('../../services/client/foo');
      } finally {
        fs.removeSync(tmpDir);
      }
    });

    it('rewrites services/server (directory import) to services/client', () => {
      var fs = require('fs-extra'),
        tmpDir = path.resolve(process.cwd(), '_test-services-rewrite2'),
        clientDir = path.join(tmpDir, 'services', 'client'),
        componentDir = path.join(tmpDir, 'components', 'bar'),
        resource = {
          request: '../../services/server',
          context: componentDir
        };

      try {
        fs.ensureDirSync(clientDir);
        fs.ensureDirSync(componentDir);

        scripts.rewriteServiceRequire(resource);
        expect(resource.request).toBe('../../services/client');
      } finally {
        fs.removeSync(tmpDir);
      }
    });
  });
});

describe('buildScripts contract', () => {
  var fs = require('fs-extra'),
    glob = require('glob'),
    configFileHelpers = require('../../config-file-helpers'),
    destPath = scripts._destPath,
    registryPath = path.join(destPath, '_registry.json'),
    idsPath = path.join(destPath, '_ids.json'),
    clientEnvPath = path.resolve(process.cwd(), 'client-env.json'),
    cacheDir = path.resolve(process.cwd(), '.webpack-cache'),
    fixtureDir = path.resolve(process.cwd(), '_test-contract-fixture'),
    entryFile = path.join(fixtureDir, 'entry.js'),
    result;

  function createFixture() {
    var helperFile = path.join(fixtureDir, 'lib', 'helper.js'),
      serverSvc = path.join(fixtureDir, 'services', 'server', 'svc.js'),
      clientSvc = path.join(fixtureDir, 'services', 'client', 'svc.js');

    fs.removeSync(destPath);
    fs.removeSync(clientEnvPath);
    fs.removeSync(cacheDir);
    fs.removeSync(fixtureDir);

    fs.ensureDirSync(path.join(fixtureDir, 'lib'));
    fs.ensureDirSync(path.join(fixtureDir, 'services', 'server'));
    fs.ensureDirSync(path.join(fixtureDir, 'services', 'client'));

    fs.writeFileSync(entryFile,
      '\'use strict\';\n' +
      'var helper = require(\'./lib/helper\');\n' +
      'var svc = require(\'./services/server/svc\');\n' +
      'var env = process.env.TEST_CONTRACT_VAR;\n' +
      'module.exports = { helper: helper, svc: svc, env: env };\n'
    );
    fs.writeFileSync(helperFile,
      '\'use strict\';\n' +
      'module.exports = \'hello from helper\';\n'
    );
    fs.writeFileSync(serverSvc,
      '\'use strict\';\n' +
      'module.exports = \'server-side\';\n'
    );
    fs.writeFileSync(clientSvc,
      '\'use strict\';\n' +
      'module.exports = \'client-side\';\n'
    );
  }

  beforeAll(async () => {
    // Provide valid babel targets (default browserslist uses autoprefixer format
    // which is invalid for @babel/preset-env; production builds get targets from
    // claycli.config.js in the consuming project)
    configFileHelpers.setConfigFile({ babelTargets: { chrome: '89' } });

    createFixture();
    result = await scripts.buildScripts([entryFile], {});
  }, 30000);

  afterAll(() => {
    fs.removeSync(fixtureDir);
    fs.removeSync(destPath);
    fs.removeSync(clientEnvPath);
    fs.removeSync(cacheDir);
  });

  it('returns success results', () => {
    var successes = result.filter((r) => r.type === 'success');

    expect(successes.length).toBeGreaterThan(0);
  });

  it('writes _registry.json with non-empty dependency edges', () => {
    var registry = fs.readJsonSync(registryPath),
      entries = Object.entries(registry),
      withDeps = entries.filter(([, deps]) => Array.isArray(deps) && deps.length > 0);

    expect(entries.length).toBeGreaterThan(0);
    expect(withDeps.length).toBeGreaterThan(0);
  });

  it('writes _ids.json with file-to-id mapping', () => {
    var ids = fs.readJsonSync(idsPath);

    expect(Object.keys(ids).length).toBeGreaterThan(0);
  });

  it('writes output files in global-pack format', () => {
    var outFiles = glob.sync(path.join(destPath, '*.js')),
      hasModuleFormat = outFiles.some((f) => {
        var content = fs.readFileSync(f, 'utf8');

        return content.includes('window.modules["');
      });

    expect(outFiles.length).toBeGreaterThan(0);
    expect(hasModuleFormat).toBe(true);
  });

  it('module wrappers contain populated dependency maps', () => {
    var outFiles = glob.sync(path.join(destPath, '*.js')),
      allContent = outFiles.map((f) => fs.readFileSync(f, 'utf8')).join('\n'),
      // Match: window.modules["id"] = [..., {non-empty deps}];
      modulePattern = /window\.modules\["[^"]+"\] = \[function[^]*?\},\s*(\{[^}]*\})\];/g,
      match, depsStr, hasNonEmptyDeps = false;

    match = modulePattern.exec(allContent);
    while (match) {
      depsStr = match[1];
      if (depsStr && depsStr !== '{}') {
        hasNonEmptyDeps = true;
      }
      match = modulePattern.exec(allContent);
    }

    expect(hasNonEmptyDeps).toBe(true);
  });

  it('extracts environment variables to client-env.json', () => {
    var env = fs.readJsonSync(clientEnvPath);

    expect(env).toContain('TEST_CONTRACT_VAR');
  });

  it('rewrites services/server requires to services/client in output', () => {
    var outFiles = glob.sync(path.join(destPath, '*.js')),
      allContent = outFiles.map((f) => fs.readFileSync(f, 'utf8')).join('\n'),
      ids = fs.readJsonSync(idsPath),
      clientSvcPath = path.join(fixtureDir, 'services', 'client', 'svc.js'),
      clientSvcId = ids[clientSvcPath];

    // The client-side service module should have been resolved and given an ID
    expect(clientSvcId).toBeDefined();
    // The server-side path should NOT appear in _ids.json (it was rewritten)
    expect(ids[path.join(fixtureDir, 'services', 'server', 'svc.js')]).toBeUndefined();
    // The client service module should be in the output
    expect(allContent).toContain('window.modules["' + clientSvcId + '"]');
  });

  it('does not emit nested directories or absolute-path files under destPath', () => {
    var nestedFiles = glob.sync(path.join(destPath, '**', '*.js'), { nodir: true })
      .filter((f) => path.relative(destPath, f).includes(path.sep));

    expect(nestedFiles).toEqual([]);
  });

  it('produces smaller output when minify is true', async () => {
    var normalFiles = glob.sync(path.join(destPath, '*.js')),
      normalSize = normalFiles.reduce((sum, f) => sum + fs.readFileSync(f, 'utf8').length, 0),
      minResult, minFiles, minSize;

    // Re-run with minify enabled
    fs.removeSync(destPath);
    fs.removeSync(cacheDir);
    createFixture();
    minResult = await scripts.buildScripts([entryFile], { minify: true });
    minFiles = glob.sync(path.join(destPath, '*.js'));
    minSize = minFiles.reduce((sum, f) => sum + fs.readFileSync(f, 'utf8').length, 0);

    expect(minResult.some((r) => r.type === 'success')).toBe(true);
    expect(minSize).toBeLessThan(normalSize);

    // Restore non-minified output for other tests
    fs.removeSync(destPath);
    fs.removeSync(cacheDir);
    createFixture();
    await scripts.buildScripts([entryFile], {});
  }, 30000);

  it('preserves global-pack format when minified', async () => {
    var outFiles, allContent, hasModuleFormat;

    fs.removeSync(destPath);
    fs.removeSync(cacheDir);
    createFixture();
    await scripts.buildScripts([entryFile], { minify: true });

    outFiles = glob.sync(path.join(destPath, '*.js'));
    allContent = outFiles.map((f) => fs.readFileSync(f, 'utf8')).join('\n');
    // Terser may drop quotes for numeric IDs (window.modules["1"] → window.modules[1])
    // which is functionally equivalent; check for the wrapper pattern broadly
    hasModuleFormat = allContent.includes('window.modules[');

    expect(hasModuleFormat).toBe(true);

    // Restore non-minified output for other tests
    fs.removeSync(destPath);
    fs.removeSync(cacheDir);
    createFixture();
    await scripts.buildScripts([entryFile], {});
  }, 30000);
});

describe('buildScripts failure signaling', () => {
  var fs = require('fs-extra'),
    configFileHelpers = require('../../config-file-helpers'),
    destPath = scripts._destPath,
    clientEnvPath = path.resolve(process.cwd(), 'client-env.json'),
    cacheDir = path.resolve(process.cwd(), '.webpack-cache'),
    fixtureDir = path.resolve(process.cwd(), '_test-error-fixture');

  afterEach(() => {
    fs.removeSync(fixtureDir);
    fs.removeSync(destPath);
    fs.removeSync(clientEnvPath);
    fs.removeSync(cacheDir);
  });

  it('returns errors without success entries for JS compile failures', async () => {
    var entryFile = path.join(fixtureDir, 'bad-entry.js'),
      result, errors, successes;

    configFileHelpers.setConfigFile({ babelTargets: { chrome: '89' } });
    fs.ensureDirSync(fixtureDir);
    fs.writeFileSync(entryFile,
      '\'use strict\';\nvar x = {;\n'
    );

    result = await scripts.buildScripts([entryFile], {});
    errors = result.filter((r) => r.type === 'error');
    successes = result.filter((r) => r.type === 'success');

    expect(errors.length).toBeGreaterThan(0);
    expect(successes.length).toBe(0);
  }, 30000);
});

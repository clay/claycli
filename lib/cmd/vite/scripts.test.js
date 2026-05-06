/* eslint-env jest */
'use strict';

const fs = require('fs-extra');
const os = require('os');
const path = require('path');

let tmpDir, cwdSpy;

async function setupTmp(prefix) {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  cwdSpy = jest.spyOn(process, 'cwd').mockReturnValue(tmpDir);
  jest.resetModules();
}

async function cleanupTmp() {
  if (cwdSpy) cwdSpy.mockRestore();
  if (tmpDir) await fs.remove(tmpDir);
  cwdSpy = null;
  tmpDir = null;
  jest.resetModules();
}

function setStdoutTTY(value) {
  const previous = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY');

  Object.defineProperty(process.stdout, 'isTTY', {
    configurable: true,
    value,
  });

  return () => {
    if (previous) {
      Object.defineProperty(process.stdout, 'isTTY', previous);
    } else {
      delete process.stdout.isTTY;
    }
  };
}

describe('vite scripts', () => {
  afterEach(async () => {
    jest.useRealTimers();
    await cleanupTmp();
    jest.dontMock('vite');
    jest.dontMock('./generate-bootstrap');
    jest.dontMock('./generate-kiln-edit');
    jest.dontMock('./generate-globals-init');
    jest.dontMock('./plugins/client-env');
    jest.dontMock('./plugins/browser-compat');
    jest.dontMock('./plugins/service-rewrite');
    jest.dontMock('./plugins/missing-module');
    jest.dontMock('./plugins/vue2');
    jest.dontMock('./plugins/manual-chunks');
    jest.dontMock('./styles');
    jest.dontMock('./fonts');
    jest.dontMock('./templates');
    jest.dontMock('./vendor');
    jest.dontMock('./media');
    jest.dontMock('chokidar');
    jest.dontMock('../../config-file-helpers');
  });

  it('getViteConfig merges bundlerConfig customizer output', async () => {
    await setupTmp('claycli-vite-scripts-config-');

    jest.doMock('../../config-file-helpers', () => ({
      getConfigValue: jest.fn().mockImplementation(key => {
        if (key !== 'bundlerConfig') return undefined;
        return (cfg) => ({ ...cfg, minify: true, kilnSplit: true, extraEntries: ['x.js'] });
      }),
    }));

    const { getViteConfig } = require('./scripts');
    const cfg = getViteConfig({ minify: false });

    expect(cfg.minify).toBe(true);
    expect(cfg.kilnSplit).toBe(true);
    expect(cfg.extraEntries).toEqual(['x.js']);
    expect(cfg.sourcemap).toBe(true);
  });

  it('buildJS runs split builds, writes manifest and client-env', async () => {
    await setupTmp('claycli-vite-scripts-build-');

    const clayDir = path.join(tmpDir, '.clay');
    const destDir = path.join(tmpDir, 'public', 'js');
    const bootstrapFile = path.join(clayDir, 'vite-bootstrap.js');
    const kilnFile = path.join(clayDir, 'vite-kiln-edit-init.js');
    const envFile = path.join(tmpDir, 'client-env.json');

    const viewResult = {
      output: [
        {
          type: 'chunk',
          isEntry: true,
          facadeModuleId: bootstrapFile,
          fileName: '.clay/vite-bootstrap-a1b2c3d4.js',
          imports: ['chunks/shared-111.js'],
        },
      ],
    };
    const kilnResult = {
      output: [
        {
          type: 'chunk',
          isEntry: true,
          facadeModuleId: kilnFile,
          fileName: '.clay/vite-kiln-edit-init-z9y8x7w6.js',
          imports: [],
        },
      ],
    };

    const viteBuild = jest.fn()
      .mockResolvedValueOnce(viewResult)
      .mockResolvedValueOnce(kilnResult);
    const envCollector = {
      plugin: jest.fn().mockReturnValue({ name: 'env-collector' }),
      write: jest.fn().mockResolvedValue(undefined),
    };

    jest.doMock('vite', () => ({ build: viteBuild }));
    jest.doMock('./plugins/client-env', () => ({
      createClientEnvCollector: jest.fn().mockReturnValue(envCollector),
    }));
    jest.doMock('./generate-globals-init', () => ({
      generateViteGlobalsInit: jest.fn().mockResolvedValue(null),
    }));
    jest.doMock('./generate-kiln-edit', () => ({
      generateViteKilnEditEntry: jest.fn().mockResolvedValue(kilnFile),
      KILN_EDIT_ENTRY_FILE: kilnFile,
      KILN_EDIT_ENTRY_KEY: '.clay/vite-kiln-edit-init',
    }));
    jest.doMock('./generate-bootstrap', () => ({
      generateViteBootstrap: jest.fn().mockImplementation(async () => {
        await fs.ensureDir(clayDir);
        await fs.writeFile(bootstrapFile, '// bootstrap');
        return bootstrapFile;
      }),
      VITE_BOOTSTRAP_FILE: bootstrapFile,
      VITE_BOOTSTRAP_KEY: '.clay/vite-bootstrap',
    }));
    jest.doMock('./plugins/browser-compat', () => jest.fn(() => ({ name: 'browser-compat' })));
    jest.doMock('./plugins/service-rewrite', () => jest.fn(() => ({ name: 'service-rewrite' })));
    jest.doMock('./plugins/missing-module', () => jest.fn(() => ({ name: 'missing-module' })));
    jest.doMock('./plugins/vue2', () => jest.fn(() => ({ name: 'vue2' })));
    jest.doMock('./plugins/manual-chunks', () => jest.fn(() => 'manual-chunks'));
    jest.doMock('./styles', () => ({ buildStyles: jest.fn(), SRC_GLOBS: [] }));
    jest.doMock('./fonts', () => ({ buildFonts: jest.fn(), FONTS_SRC_GLOB: '' }));
    jest.doMock('./templates', () => ({ buildTemplates: jest.fn(), TEMPLATE_GLOB_PATTERN: '*.hbs' }));
    jest.doMock('./vendor', () => ({ copyVendor: jest.fn() }));
    jest.doMock('./media', () => ({ copyMedia: jest.fn() }));
    jest.doMock('../../config-file-helpers', () => ({
      getConfigValue: jest.fn().mockReturnValue(undefined),
    }));

    const { buildJS } = require('./scripts');

    await buildJS();

    const manifestPath = path.join(destDir, '_manifest.json');
    const manifest = await fs.readJson(manifestPath);

    expect(viteBuild).toHaveBeenCalledTimes(2);
    expect(envCollector.plugin).toHaveBeenCalledTimes(1);
    expect(envCollector.write).toHaveBeenCalledTimes(1);
    expect(path.dirname(envFile)).toBe(tmpDir);
    expect(manifest['.clay/vite-bootstrap'].file).toBe('/js/.clay/vite-bootstrap-a1b2c3d4.js');
    expect(manifest['.clay/vite-bootstrap'].imports).toEqual(['/js/chunks/shared-111.js']);
    expect(manifest['.clay/vite-kiln-edit-init'].file).toBe('/js/.clay/vite-kiln-edit-init-z9y8x7w6.js');
  });

  it('buildAll runs media first then parallel asset steps', async () => {
    await setupTmp('claycli-vite-scripts-buildall-');

    const order = [];

    jest.doMock('./media', () => ({
      copyMedia: jest.fn().mockImplementation(async () => {
        order.push('media');
      }),
    }));
    jest.doMock('./styles', () => ({
      buildStyles: jest.fn().mockImplementation(async () => {
        order.push('styles');
      }),
      SRC_GLOBS: [],
    }));
    jest.doMock('./fonts', () => ({
      buildFonts: jest.fn().mockImplementation(async () => {
        order.push('fonts');
      }),
      FONTS_SRC_GLOB: '',
    }));
    jest.doMock('./templates', () => ({
      buildTemplates: jest.fn().mockImplementation(async () => {
        order.push('templates');
      }),
      TEMPLATE_GLOB_PATTERN: '*.hbs',
    }));
    jest.doMock('./vendor', () => ({
      copyVendor: jest.fn().mockImplementation(async () => {
        order.push('vendor');
      }),
    }));
    jest.doMock('vite', () => ({
      build: jest.fn().mockResolvedValue({ output: [] }),
    }));
    jest.doMock('./plugins/client-env', () => ({
      createClientEnvCollector: jest.fn().mockReturnValue({
        plugin: jest.fn().mockReturnValue({ name: 'env-collector' }),
        write: jest.fn().mockResolvedValue(undefined),
      }),
    }));
    jest.doMock('./generate-globals-init', () => ({
      generateViteGlobalsInit: jest.fn().mockResolvedValue(null),
    }));
    jest.doMock('./generate-kiln-edit', () => ({
      generateViteKilnEditEntry: jest.fn().mockResolvedValue(path.join(tmpDir, '.clay', 'vite-kiln-edit-init.js')),
      KILN_EDIT_ENTRY_FILE: path.join(tmpDir, '.clay', 'vite-kiln-edit-init.js'),
      KILN_EDIT_ENTRY_KEY: '.clay/vite-kiln-edit-init',
    }));
    jest.doMock('./generate-bootstrap', () => ({
      generateViteBootstrap: jest.fn().mockImplementation(async () => {
        const file = path.join(tmpDir, '.clay', 'vite-bootstrap.js');

        await fs.ensureDir(path.dirname(file));
        await fs.writeFile(file, '// bootstrap');
        return file;
      }),
      VITE_BOOTSTRAP_FILE: path.join(tmpDir, '.clay', 'vite-bootstrap.js'),
      VITE_BOOTSTRAP_KEY: '.clay/vite-bootstrap',
    }));
    jest.doMock('./plugins/browser-compat', () => jest.fn(() => ({ name: 'browser-compat' })));
    jest.doMock('./plugins/service-rewrite', () => jest.fn(() => ({ name: 'service-rewrite' })));
    jest.doMock('./plugins/missing-module', () => jest.fn(() => ({ name: 'missing-module' })));
    jest.doMock('./plugins/vue2', () => jest.fn(() => ({ name: 'vue2' })));
    jest.doMock('./plugins/manual-chunks', () => jest.fn(() => 'manual-chunks'));
    jest.doMock('../../config-file-helpers', () => ({
      getConfigValue: jest.fn().mockReturnValue(undefined),
    }));

    const restoreTTY = setStdoutTTY(false);
    const { buildAll } = require('./scripts');

    await buildAll();

    restoreTTY();
    expect(order[0]).toBe('media');
    expect(order).toEqual(expect.arrayContaining(['styles', 'fonts', 'templates', 'vendor']));
  });

  it('buildJS supports kilnSplit single-pass mode with extra entries', async () => {
    await setupTmp('claycli-vite-scripts-kilnsplit-');

    const clayDir = path.join(tmpDir, '.clay');
    const destDir = path.join(tmpDir, 'public', 'js');
    const bootstrapFile = path.join(clayDir, 'vite-bootstrap.js');
    const kilnFile = path.join(clayDir, 'vite-kiln-edit-init.js');
    const extraFile = path.join(tmpDir, 'components', 'foo', 'client.js');

    await fs.ensureDir(path.dirname(extraFile));
    await fs.writeFile(extraFile, 'module.exports = function() {};');

    const viewResult = {
      output: [
        {
          type: 'chunk',
          isEntry: true,
          facadeModuleId: bootstrapFile,
          fileName: '.clay/vite-bootstrap-aa.js',
          imports: [],
        },
        {
          type: 'chunk',
          isEntry: true,
          facadeModuleId: kilnFile,
          fileName: '.clay/vite-kiln-edit-init-bb.js',
          imports: [],
        },
        {
          type: 'chunk',
          isEntry: true,
          facadeModuleId: extraFile,
          fileName: 'components/foo/client-cc.js',
          imports: [],
        },
      ],
    };

    const viteBuild = jest.fn().mockResolvedValue(viewResult);
    const envCollector = {
      plugin: jest.fn().mockReturnValue({ name: 'env-collector' }),
      write: jest.fn().mockResolvedValue(undefined),
    };

    jest.doMock('vite', () => ({ build: viteBuild }));
    jest.doMock('./plugins/client-env', () => ({
      createClientEnvCollector: jest.fn().mockReturnValue(envCollector),
    }));
    jest.doMock('./generate-globals-init', () => ({
      generateViteGlobalsInit: jest.fn().mockResolvedValue(null),
    }));
    jest.doMock('./generate-kiln-edit', () => ({
      generateViteKilnEditEntry: jest.fn().mockResolvedValue(kilnFile),
      KILN_EDIT_ENTRY_FILE: kilnFile,
      KILN_EDIT_ENTRY_KEY: '.clay/vite-kiln-edit-init',
    }));
    jest.doMock('./generate-bootstrap', () => ({
      generateViteBootstrap: jest.fn().mockImplementation(async () => {
        await fs.ensureDir(clayDir);
        await fs.writeFile(bootstrapFile, '// bootstrap');
        return bootstrapFile;
      }),
      VITE_BOOTSTRAP_FILE: bootstrapFile,
      VITE_BOOTSTRAP_KEY: '.clay/vite-bootstrap',
    }));
    jest.doMock('./plugins/browser-compat', () => jest.fn(() => ({ name: 'browser-compat' })));
    jest.doMock('./plugins/service-rewrite', () => jest.fn(() => ({ name: 'service-rewrite' })));
    jest.doMock('./plugins/missing-module', () => jest.fn(() => ({ name: 'missing-module' })));
    jest.doMock('./plugins/vue2', () => jest.fn(() => ({ name: 'vue2' })));
    jest.doMock('./plugins/manual-chunks', () => jest.fn(() => 'manual-chunks'));
    jest.doMock('./styles', () => ({ buildStyles: jest.fn(), SRC_GLOBS: [] }));
    jest.doMock('./fonts', () => ({ buildFonts: jest.fn(), FONTS_SRC_GLOB: '' }));
    jest.doMock('./templates', () => ({ buildTemplates: jest.fn(), TEMPLATE_GLOB_PATTERN: '*.hbs' }));
    jest.doMock('./vendor', () => ({ copyVendor: jest.fn() }));
    jest.doMock('./media', () => ({ copyMedia: jest.fn() }));
    jest.doMock('../../config-file-helpers', () => ({
      getConfigValue: jest.fn().mockImplementation(key => {
        if (key !== 'bundlerConfig') return undefined;
        return cfg => ({ ...cfg, kilnSplit: true, extraEntries: [extraFile] });
      }),
    }));

    const { buildJS } = require('./scripts');

    await buildJS();

    const manifest = await fs.readJson(path.join(destDir, '_manifest.json'));

    expect(viteBuild).toHaveBeenCalledTimes(1);
    expect(manifest['.clay/vite-bootstrap'].file).toBe('/js/.clay/vite-bootstrap-aa.js');
    expect(manifest['.clay/vite-kiln-edit-init'].file).toBe('/js/.clay/vite-kiln-edit-init-bb.js');
    expect(manifest['components/foo/client'].file).toBe('/js/components/foo/client-cc.js');
  });

  it('buildJS fails clearly when bootstrap file was not generated', async () => {
    await setupTmp('claycli-vite-scripts-missing-bootstrap-');

    const clayDir = path.join(tmpDir, '.clay');
    const bootstrapFile = path.join(clayDir, 'vite-bootstrap.js');
    const kilnFile = path.join(clayDir, 'vite-kiln-edit-init.js');

    jest.doMock('vite', () => ({ build: jest.fn() }));
    jest.doMock('./plugins/client-env', () => ({
      createClientEnvCollector: jest.fn().mockReturnValue({
        plugin: jest.fn().mockReturnValue({ name: 'env-collector' }),
        write: jest.fn().mockResolvedValue(undefined),
      }),
    }));
    jest.doMock('./generate-globals-init', () => ({
      generateViteGlobalsInit: jest.fn().mockResolvedValue(null),
    }));
    jest.doMock('./generate-kiln-edit', () => ({
      generateViteKilnEditEntry: jest.fn().mockResolvedValue(kilnFile),
      KILN_EDIT_ENTRY_FILE: kilnFile,
      KILN_EDIT_ENTRY_KEY: '.clay/vite-kiln-edit-init',
    }));
    jest.doMock('./generate-bootstrap', () => ({
      generateViteBootstrap: jest.fn().mockResolvedValue(bootstrapFile),
      VITE_BOOTSTRAP_FILE: bootstrapFile,
      VITE_BOOTSTRAP_KEY: '.clay/vite-bootstrap',
    }));
    jest.doMock('./plugins/browser-compat', () => jest.fn(() => ({ name: 'browser-compat' })));
    jest.doMock('./plugins/service-rewrite', () => jest.fn(() => ({ name: 'service-rewrite' })));
    jest.doMock('./plugins/missing-module', () => jest.fn(() => ({ name: 'missing-module' })));
    jest.doMock('./plugins/vue2', () => jest.fn(() => ({ name: 'vue2' })));
    jest.doMock('./plugins/manual-chunks', () => jest.fn(() => 'manual-chunks'));
    jest.doMock('./styles', () => ({ buildStyles: jest.fn(), SRC_GLOBS: [] }));
    jest.doMock('./fonts', () => ({ buildFonts: jest.fn(), FONTS_SRC_GLOB: '' }));
    jest.doMock('./templates', () => ({ buildTemplates: jest.fn(), TEMPLATE_GLOB_PATTERN: '*.hbs' }));
    jest.doMock('./vendor', () => ({ copyVendor: jest.fn() }));
    jest.doMock('./media', () => ({ copyMedia: jest.fn() }));
    jest.doMock('../../config-file-helpers', () => ({
      getConfigValue: jest.fn().mockReturnValue(undefined),
    }));

    const { buildJS } = require('./scripts');

    await expect(buildJS()).rejects.toThrow('clay vite: missing .clay/vite-bootstrap.js after prepare.');
  });

  it('buildAll reports failed steps with aggregate error', async () => {
    await setupTmp('claycli-vite-scripts-buildall-fail-');

    jest.doMock('./media', () => ({ copyMedia: jest.fn().mockResolvedValue(undefined) }));
    jest.doMock('./styles', () => ({
      buildStyles: jest.fn().mockRejectedValue(new Error('styles failed')),
      SRC_GLOBS: [],
    }));
    jest.doMock('./fonts', () => ({
      buildFonts: jest.fn().mockResolvedValue(undefined),
      FONTS_SRC_GLOB: '',
    }));
    jest.doMock('./templates', () => ({
      buildTemplates: jest.fn().mockResolvedValue(undefined),
      TEMPLATE_GLOB_PATTERN: '*.hbs',
    }));
    jest.doMock('./vendor', () => ({ copyVendor: jest.fn().mockResolvedValue(undefined) }));
    jest.doMock('vite', () => ({
      build: jest.fn().mockResolvedValue({ output: [] }),
    }));
    jest.doMock('./plugins/client-env', () => ({
      createClientEnvCollector: jest.fn().mockReturnValue({
        plugin: jest.fn().mockReturnValue({ name: 'env-collector' }),
        write: jest.fn().mockResolvedValue(undefined),
      }),
    }));
    jest.doMock('./generate-globals-init', () => ({
      generateViteGlobalsInit: jest.fn().mockResolvedValue(null),
    }));
    jest.doMock('./generate-kiln-edit', () => ({
      generateViteKilnEditEntry: jest.fn().mockResolvedValue(path.join(tmpDir, '.clay', 'vite-kiln-edit-init.js')),
      KILN_EDIT_ENTRY_FILE: path.join(tmpDir, '.clay', 'vite-kiln-edit-init.js'),
      KILN_EDIT_ENTRY_KEY: '.clay/vite-kiln-edit-init',
    }));
    jest.doMock('./generate-bootstrap', () => ({
      generateViteBootstrap: jest.fn().mockImplementation(async () => {
        const file = path.join(tmpDir, '.clay', 'vite-bootstrap.js');

        await fs.ensureDir(path.dirname(file));
        await fs.writeFile(file, '// bootstrap');
        return file;
      }),
      VITE_BOOTSTRAP_FILE: path.join(tmpDir, '.clay', 'vite-bootstrap.js'),
      VITE_BOOTSTRAP_KEY: '.clay/vite-bootstrap',
    }));
    jest.doMock('./plugins/browser-compat', () => jest.fn(() => ({ name: 'browser-compat' })));
    jest.doMock('./plugins/service-rewrite', () => jest.fn(() => ({ name: 'service-rewrite' })));
    jest.doMock('./plugins/missing-module', () => jest.fn(() => ({ name: 'missing-module' })));
    jest.doMock('./plugins/vue2', () => jest.fn(() => ({ name: 'vue2' })));
    jest.doMock('./plugins/manual-chunks', () => jest.fn(() => 'manual-chunks'));
    jest.doMock('../../config-file-helpers', () => ({
      getConfigValue: jest.fn().mockReturnValue(undefined),
    }));

    const restoreTTY = setStdoutTTY(false);
    const { buildAll } = require('./scripts');

    await expect(buildAll()).rejects.toThrow(/Build failed: 1 step\(s\) failed — styles failed/);
    restoreTTY();
  });

  it('watch wires rollup/chokidar and dispose closes all watchers', async () => {
    await setupTmp('claycli-vite-scripts-watch-');

    const jsRollupHandlers = {};
    const kilnRollupHandlers = {};
    const chokidarWatchers = [];
    const rollupWatchers = [];

    function createRollupWatcher(handlerBag) {
      const watcher = {
        on: jest.fn((evt, cb) => {
          handlerBag[evt] = cb;
          return watcher;
        }),
        close: jest.fn(),
      };

      return watcher;
    }

    function createChokidarWatcher() {
      const handlers = {};
      const watcher = {
        on: jest.fn((evt, cb) => {
          handlers[evt] = cb;
          return watcher;
        }),
        once: jest.fn((evt, cb) => {
          if (evt === 'ready') setImmediate(cb);
          return watcher;
        }),
        close: jest.fn().mockResolvedValue(undefined),
      };

      watcher.__handlers = handlers;
      chokidarWatchers.push(watcher);
      return watcher;
    }

    const viteBuild = jest.fn().mockImplementation(async () => {
      const watcher = rollupWatchers.length === 0
        ? createRollupWatcher(kilnRollupHandlers)
        : createRollupWatcher(jsRollupHandlers);

      rollupWatchers.push(watcher);
      return watcher;
    });

    jest.doMock('vite', () => ({ build: viteBuild }));
    jest.doMock('chokidar', () => ({
      watch: jest.fn(() => createChokidarWatcher()),
    }));
    jest.doMock('./plugins/client-env', () => ({
      createClientEnvCollector: jest.fn().mockReturnValue({
        plugin: jest.fn().mockReturnValue({ name: 'env-collector' }),
        write: jest.fn().mockResolvedValue(undefined),
      }),
    }));
    jest.doMock('./generate-globals-init', () => ({
      generateViteGlobalsInit: jest.fn().mockResolvedValue(null),
    }));
    jest.doMock('./generate-kiln-edit', () => ({
      generateViteKilnEditEntry: jest.fn().mockResolvedValue(path.join(tmpDir, '.clay', 'vite-kiln-edit-init.js')),
      KILN_EDIT_ENTRY_FILE: path.join(tmpDir, '.clay', 'vite-kiln-edit-init.js'),
      KILN_EDIT_ENTRY_KEY: '.clay/vite-kiln-edit-init',
    }));
    jest.doMock('./generate-bootstrap', () => ({
      generateViteBootstrap: jest.fn().mockImplementation(async () => {
        const file = path.join(tmpDir, '.clay', 'vite-bootstrap.js');

        await fs.ensureDir(path.dirname(file));
        await fs.writeFile(file, '// bootstrap');
        return file;
      }),
      VITE_BOOTSTRAP_FILE: path.join(tmpDir, '.clay', 'vite-bootstrap.js'),
      VITE_BOOTSTRAP_KEY: '.clay/vite-bootstrap',
    }));
    jest.doMock('./plugins/browser-compat', () => jest.fn(() => ({ name: 'browser-compat' })));
    jest.doMock('./plugins/service-rewrite', () => jest.fn(() => ({ name: 'service-rewrite' })));
    jest.doMock('./plugins/missing-module', () => jest.fn(() => ({ name: 'missing-module' })));
    jest.doMock('./plugins/vue2', () => jest.fn(() => ({ name: 'vue2' })));
    jest.doMock('./plugins/manual-chunks', () => jest.fn(() => 'manual-chunks'));
    const buildStylesMock = jest.fn().mockResolvedValue(undefined);
    const buildFontsMock = jest.fn().mockResolvedValue(undefined);
    const buildTemplatesMock = jest.fn().mockResolvedValue(undefined);

    jest.doMock('./styles', () => ({ buildStyles: buildStylesMock, SRC_GLOBS: [] }));
    jest.doMock('./fonts', () => ({ buildFonts: buildFontsMock, FONTS_SRC_GLOB: '' }));
    jest.doMock('./templates', () => ({ buildTemplates: buildTemplatesMock, TEMPLATE_GLOB_PATTERN: '*.hbs' }));
    jest.doMock('./vendor', () => ({ copyVendor: jest.fn().mockResolvedValue(undefined) }));
    jest.doMock('./media', () => ({ copyMedia: jest.fn().mockResolvedValue(undefined) }));
    jest.doMock('../../config-file-helpers', () => ({
      getConfigValue: jest.fn().mockReturnValue(undefined),
    }));

    const restoreTTY = setStdoutTTY(false);
    const onRebuild = jest.fn();
    const onReady = jest.fn();
    const { watch } = require('./scripts');
    const session = await watch({ onRebuild, onReady });

    expect(viteBuild).toHaveBeenCalledTimes(2);
    expect(jsRollupHandlers.event).toBeDefined();
    expect(kilnRollupHandlers.event).toBeDefined();

    const kilnCfg = viteBuild.mock.calls[0][0];
    const jsCfg = viteBuild.mock.calls[1][0];
    const kilnCapture = kilnCfg.plugins.find(p => p.name === 'clay-capture-kiln-output');
    const jsCapture = jsCfg.plugins.find(p => p.name === 'clay-capture-watch-output');
    const jsResult = { close: jest.fn() };
    const kilnResult = { close: jest.fn() };

    expect(kilnCapture).toBeTruthy();
    expect(jsCapture).toBeTruthy();

    jsRollupHandlers.event({ code: 'BUNDLE_START' });
    jsCapture.writeBundle(null, {
      '.clay/vite-bootstrap-a.js': {
        type: 'chunk',
        isEntry: true,
        facadeModuleId: path.join(tmpDir, '.clay', 'vite-bootstrap.js'),
        fileName: '.clay/vite-bootstrap-a.js',
        imports: [],
      },
    });
    await jsRollupHandlers.event({ code: 'BUNDLE_END', duration: 12, result: jsResult });

    kilnRollupHandlers.event({ code: 'BUNDLE_START' });
    kilnCapture.writeBundle(null, {
      '.clay/vite-kiln-edit-init-a.js': {
        type: 'chunk',
        isEntry: true,
        facadeModuleId: path.join(tmpDir, '.clay', 'vite-kiln-edit-init.js'),
        fileName: '.clay/vite-kiln-edit-init-a.js',
        imports: [],
      },
    });
    await kilnRollupHandlers.event({ code: 'BUNDLE_END', duration: 9, result: kilnResult });

    // Trigger chokidar add/change paths to exercise debounced rebuild handlers.
    const jsWatcher = chokidarWatchers[0];
    const cssWatcher = chokidarWatchers[1];
    const fontWatcher = chokidarWatchers[2];
    const templateWatcher = chokidarWatchers[3];

    jsWatcher.__handlers.add(path.join(tmpDir, 'components', 'foo', 'client.js'));
    jsWatcher.__handlers.add(path.join(tmpDir, 'global', 'js', 'site.js'));
    jsWatcher.__handlers.add(path.join(tmpDir, 'components', 'foo', 'model.js'));
    jsWatcher.__handlers.unlink(path.join(tmpDir, 'components', 'foo', 'client.js'));
    jsWatcher.__handlers.change(path.join(tmpDir, 'components', 'foo', 'client.js'));
    cssWatcher.__handlers.change(path.join(tmpDir, 'styleguides', 'sg', 'components', 'nav.css'));
    fontWatcher.__handlers.change(path.join(tmpDir, 'fonts', 'a.woff'));
    templateWatcher.__handlers.change(path.join(tmpDir, 'components', 'foo', 'template.hbs'));
    await new Promise(resolve => setTimeout(resolve, 350));

    buildStylesMock.mockRejectedValueOnce(new Error('style watch fail'));
    buildFontsMock.mockRejectedValueOnce(new Error('font watch fail'));
    buildTemplatesMock.mockRejectedValueOnce(new Error('template watch fail'));
    cssWatcher.__handlers.change(path.join(tmpDir, 'styleguides', 'sg', 'components', 'nav.css'));
    fontWatcher.__handlers.change(path.join(tmpDir, 'fonts', 'a.woff'));
    templateWatcher.__handlers.change(path.join(tmpDir, 'components', 'foo', 'template.hbs'));
    await new Promise(resolve => setTimeout(resolve, 350));

    expect(onRebuild).toHaveBeenCalled();
    expect(onReady).toHaveBeenCalled();
    expect(jsResult.close).toHaveBeenCalled();
    expect(kilnResult.close).toHaveBeenCalled();
    expect(buildStylesMock).toHaveBeenCalled();
    expect(buildFontsMock).toHaveBeenCalled();
    expect(buildTemplatesMock).toHaveBeenCalled();

    await session.dispose();
    restoreTTY();

    expect(rollupWatchers[0].close).toHaveBeenCalled();
    expect(rollupWatchers[1].close).toHaveBeenCalled();
    expect(chokidarWatchers).toHaveLength(4);
    chokidarWatchers.forEach((w) => {
      expect(w.close).toHaveBeenCalled();
    });
  });
});

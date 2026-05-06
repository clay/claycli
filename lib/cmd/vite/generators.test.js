/* eslint-env jest */
'use strict';

const fs = require('fs-extra');
const os = require('os');
const path = require('path');

let cwdSpy, tmpDir;

async function setupTmpDir(prefix) {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  cwdSpy = jest.spyOn(process, 'cwd').mockReturnValue(tmpDir);
  jest.resetModules();
}

async function cleanupTmpDir() {
  if (cwdSpy) cwdSpy.mockRestore();
  if (tmpDir) await fs.remove(tmpDir);
  cwdSpy = null;
  tmpDir = null;
  jest.resetModules();
}

describe('generate-vite env/bootstrap/kiln generators', () => {
  afterEach(async () => {
    await cleanupTmpDir();
    jest.dontMock('./generate-env-init');
    jest.dontMock('../../config-file-helpers');
  });

  describe('generate-env-init', () => {
    it('writes .clay/_env-init.js with hydration runtime', async () => {
      await setupTmpDir('claycli-vite-env-');

      const { generateViteEnvInit, ENV_INIT_FILE } = require('./generate-env-init');
      const writtenPath = await generateViteEnvInit();
      const content = await fs.readFile(ENV_INIT_FILE, 'utf8');

      expect(writtenPath).toBe(ENV_INIT_FILE);
      expect(await fs.pathExists(ENV_INIT_FILE)).toBe(true);
      expect(content).toContain('AUTO-GENERATED');
      expect(content).toContain('window.kiln.preloadData._envVars');
      expect(content).toContain('window.process.env = Object.assign');
    });
  });

  describe('generate-globals-init', () => {
    it('returns null when global/js has no non-test files', async () => {
      await setupTmpDir('claycli-vite-globals-empty-');

      await fs.ensureDir(path.join(tmpDir, 'global', 'js'));
      await fs.writeFile(path.join(tmpDir, 'global', 'js', 'foo.test.js'), 'module.exports = {};');

      const { generateViteGlobalsInit, GLOBALS_INIT_FILE } = require('./generate-globals-init');
      const writtenPath = await generateViteGlobalsInit();

      expect(writtenPath).toBeNull();
      expect(await fs.pathExists(GLOBALS_INIT_FILE)).toBe(false);
    });

    it('writes _globals-init.js with imports for every non-test global script', async () => {
      await setupTmpDir('claycli-vite-globals-');

      await fs.ensureDir(path.join(tmpDir, 'global', 'js'));
      await fs.writeFile(path.join(tmpDir, 'global', 'js', 'a.js'), 'window.a = true;');
      await fs.writeFile(path.join(tmpDir, 'global', 'js', 'b.js'), 'window.b = true;');
      await fs.writeFile(path.join(tmpDir, 'global', 'js', 'b.test.js'), 'window.bt = true;');

      const { generateViteGlobalsInit, GLOBALS_INIT_FILE } = require('./generate-globals-init');
      const writtenPath = await generateViteGlobalsInit();
      const content = await fs.readFile(GLOBALS_INIT_FILE, 'utf8');

      expect(writtenPath).toBe(GLOBALS_INIT_FILE);
      expect(content).toContain("import './../global/js/a.js';");
      expect(content).toContain("import './../global/js/b.js';");
      expect(content).not.toContain('b.test.js');
    });
  });

  describe('generate-bootstrap', () => {
    it('builds bootstrap with env/globals imports, sticky shim and module map', async () => {
      await setupTmpDir('claycli-vite-bootstrap-');

      await fs.ensureDir(path.join(tmpDir, '.clay'));
      await fs.writeFile(path.join(tmpDir, '.clay', '_globals-init.js'), '// globals');
      await fs.ensureDir(path.join(tmpDir, 'components', 'article'));
      await fs.writeFile(path.join(tmpDir, 'components', 'article', 'client.js'), 'module.exports = function() {};');
      await fs.ensureDir(path.join(tmpDir, 'layouts', 'homepage'));
      await fs.writeFile(path.join(tmpDir, 'layouts', 'homepage', 'client.js'), 'module.exports = function() {};');

      const generateEnvInitMock = jest.fn().mockResolvedValue(path.join(tmpDir, '.clay', '_env-init.js'));

      jest.doMock('./generate-env-init', () => ({
        generateViteEnvInit: generateEnvInitMock,
      }));
      jest.doMock('../../config-file-helpers', () => ({
        getConfigValue: jest.fn().mockReturnValue(['auth:init']),
      }));

      const { generateViteBootstrap, VITE_BOOTSTRAP_FILE, VITE_BOOTSTRAP_KEY } = require('./generate-bootstrap');
      const writtenPath = await generateViteBootstrap();
      const content = await fs.readFile(VITE_BOOTSTRAP_FILE, 'utf8');

      expect(generateEnvInitMock).toHaveBeenCalledTimes(1);
      expect(writtenPath).toBe(VITE_BOOTSTRAP_FILE);
      expect(VITE_BOOTSTRAP_KEY).toBe('.clay/vite-bootstrap');
      expect(content).toContain("import './_env-init.js';");
      expect(content).toContain("import './_globals-init.js';");
      expect(content).toContain('window.modules = window.modules || {};');
      expect(content).toContain('"components/article/client.js": () => import("../components/article/client.js")');
      expect(content).toContain('"layouts/homepage/client.js": () => import("../layouts/homepage/client.js")');
      expect(content).toContain('fired["auth:init"] = ev.detail;');
      expect(content).toContain('mountComponentModules().catch(console.error);');
    });

    it('omits sticky shim and globals import when not configured', async () => {
      await setupTmpDir('claycli-vite-bootstrap-min-');
      await fs.ensureDir(path.join(tmpDir, 'components', 'article'));
      await fs.writeFile(path.join(tmpDir, 'components', 'article', 'client.js'), 'module.exports = function() {};');

      jest.doMock('./generate-env-init', () => ({
        generateViteEnvInit: jest.fn().mockResolvedValue(path.join(tmpDir, '.clay', '_env-init.js')),
      }));
      jest.doMock('../../config-file-helpers', () => ({
        getConfigValue: jest.fn().mockReturnValue(undefined),
      }));

      const { generateViteBootstrap, VITE_BOOTSTRAP_FILE } = require('./generate-bootstrap');

      await generateViteBootstrap();
      const content = await fs.readFile(VITE_BOOTSTRAP_FILE, 'utf8');

      expect(content).toContain('// no global/js — skipping _globals-init');
      expect(content).not.toContain('clayViteStickyEvents');
    });
  });

  describe('generate-kiln-edit', () => {
    it('builds kiln edit entry with models, kilnjs, and optional kiln plugin', async () => {
      await setupTmpDir('claycli-vite-kiln-');

      await fs.ensureDir(path.join(tmpDir, 'components', 'article'));
      await fs.writeFile(path.join(tmpDir, 'components', 'article', 'model.js'), 'module.exports = {};');
      await fs.writeFile(path.join(tmpDir, 'components', 'article', 'kiln.js'), 'module.exports = function() {};');
      await fs.ensureDir(path.join(tmpDir, 'layouts', 'homepage'));
      await fs.writeFile(path.join(tmpDir, 'layouts', 'homepage', 'model.js'), 'module.exports = {};');
      await fs.ensureDir(path.join(tmpDir, 'services', 'kiln'));
      await fs.writeFile(path.join(tmpDir, 'services', 'kiln', 'index.js'), 'module.exports = function() {};');

      const generateEnvInitMock = jest.fn().mockResolvedValue(path.join(tmpDir, '.clay', '_env-init.js'));

      jest.doMock('./generate-env-init', () => ({
        generateViteEnvInit: generateEnvInitMock,
      }));

      const { generateViteKilnEditEntry, KILN_EDIT_ENTRY_FILE, KILN_EDIT_ENTRY_KEY } = require('./generate-kiln-edit');
      const writtenPath = await generateViteKilnEditEntry();
      const content = await fs.readFile(KILN_EDIT_ENTRY_FILE, 'utf8');

      expect(generateEnvInitMock).toHaveBeenCalledTimes(1);
      expect(writtenPath).toBe(KILN_EDIT_ENTRY_FILE);
      expect(KILN_EDIT_ENTRY_KEY).toBe('.clay/vite-kiln-edit-init');
      expect(content).toContain('import \'./_env-init.js\';');
      expect(content).toContain('import * as _m0 from "../components/article/model.js";');
      expect(content).toContain('import * as _m1 from "../layouts/homepage/model.js";');
      expect(content).toContain('import * as _k0 from "../components/article/kiln.js";');
      expect(content).toContain('import * as _kilnPluginNs from "../services/kiln/index.js";');
      expect(content).toContain('window.kiln.componentModels["article"] = _resolveDefault(_m0);');
      expect(content).toContain('window.kiln.componentKilnjs["article"] = _resolveDefault(_k0);');
      expect(content).toContain('if (typeof _initKilnPlugins === "function") _initKilnPlugins();');
    });

    it('does not import kiln plugin when services/kiln/index.js is missing', async () => {
      await setupTmpDir('claycli-vite-kiln-noplugin-');

      await fs.ensureDir(path.join(tmpDir, 'components', 'article'));
      await fs.writeFile(path.join(tmpDir, 'components', 'article', 'model.js'), 'module.exports = {};');

      jest.doMock('./generate-env-init', () => ({
        generateViteEnvInit: jest.fn().mockResolvedValue(path.join(tmpDir, '.clay', '_env-init.js')),
      }));

      const { generateViteKilnEditEntry, KILN_EDIT_ENTRY_FILE } = require('./generate-kiln-edit');

      await generateViteKilnEditEntry();
      const content = await fs.readFile(KILN_EDIT_ENTRY_FILE, 'utf8');

      expect(content).not.toContain('_kilnPluginNs');
      expect(content).not.toContain('_initKilnPlugins');
    });
  });
});

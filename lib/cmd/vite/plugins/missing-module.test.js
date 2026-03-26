/* eslint-env jest */

'use strict';

const path = require('path');

// Use a real temp dir so we can create/read actual files for the empty-file test.
const os = require('os');
const fs = require('fs');

const viteMissingModulePlugin = require('./missing-module');

// ── helpers ───────────────────────────────────────────────────────────────────

function makePlugin() {
  const plugin = viteMissingModulePlugin();

  return {
    resolveId: (id, importer) => plugin.resolveId(id, importer),
    load:      id => plugin.load(id),
    name:      plugin.name,
    enforce:   plugin.enforce,
  };
}

const IMPORTER = path.join(os.tmpdir(), 'clay-test', 'components', 'nav', 'client.js');

// ── resolveId — guards ────────────────────────────────────────────────────────

describe('viteMissingModulePlugin', () => {
  describe('resolveId — early-return guards', () => {
    it('returns null when importer is falsy (top-level entry)', () => {
      const { resolveId } = makePlugin();

      expect(resolveId('./helper', null)).toBeNull();
      expect(resolveId('./helper', '')).toBeNull();
    });

    it('returns null for non-relative imports (node_modules)', () => {
      const { resolveId } = makePlugin();

      expect(resolveId('lodash', IMPORTER)).toBeNull();
      expect(resolveId('events', IMPORTER)).toBeNull();
    });

    it('returns null when cleanImporter is not absolute', () => {
      const { resolveId } = makePlugin();

      expect(resolveId('./helper', 'relative/importer.js')).toBeNull();
    });

    it('returns null for importers inside node_modules', () => {
      const { resolveId } = makePlugin();
      const nmImporter = path.join(os.tmpdir(), 'node_modules', 'some-pkg', 'index.js');

      expect(resolveId('./helper', nmImporter)).toBeNull();
    });
  });

  describe('resolveId — missing file is stubbed', () => {
    it('returns the virtual id for a relative import that does not exist on disk', () => {
      const { resolveId } = makePlugin();
      const id       = './definitely-does-not-exist-xyz-abc';
      const warnSpy  = jest.spyOn(console, 'warn').mockImplementation(() => {});
      const result   = resolveId(id, IMPORTER);

      warnSpy.mockRestore();
      expect(result).toBe(`\0clay-vite-missing:${id}`);
    });

    it('logs a warning for the missing module', () => {
      const { resolveId } = makePlugin();
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

      resolveId('./not-there-either', IMPORTER);

      expect(warnSpy).toHaveBeenCalled();
      expect(warnSpy.mock.calls[0][0]).toContain('[clay vite] skipping missing module');
      warnSpy.mockRestore();
    });
  });

  describe('resolveId — empty file is stubbed', () => {
    let tmpDir, emptyFile;

    beforeAll(() => {
      tmpDir   = fs.mkdtempSync(path.join(os.tmpdir(), 'clay-missing-test-'));
      emptyFile = path.join(tmpDir, 'empty.js');
      fs.writeFileSync(emptyFile, '   ');
    });

    afterAll(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('stubs an empty file (only whitespace)', () => {
      const { resolveId } = makePlugin();
      const fakeImporter  = path.join(tmpDir, 'importer.js');
      const id            = './empty';

      const result = resolveId(id, fakeImporter);

      expect(result).toBe(`\0clay-vite-missing:${id}`);
    });
  });

  describe('resolveId — real file is NOT stubbed', () => {
    let tmpDir, realFile;

    beforeAll(() => {
      tmpDir   = fs.mkdtempSync(path.join(os.tmpdir(), 'clay-real-test-'));
      realFile  = path.join(tmpDir, 'real.js');
      fs.writeFileSync(realFile, 'module.exports = 42;');
    });

    afterAll(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('returns null for an import that resolves to a real, non-empty file', () => {
      const { resolveId } = makePlugin();
      const fakeImporter  = path.join(tmpDir, 'importer.js');

      const result = resolveId('./real', fakeImporter);

      expect(result).toBeNull();
    });
  });

  describe('load', () => {
    it('returns an empty-export stub for virtual ids', () => {
      const { load } = makePlugin();
      const virtual  = '\0clay-vite-missing:./helper';

      expect(load(virtual)).toBe('export default undefined;');
    });

    it('returns null for non-virtual ids', () => {
      const { load } = makePlugin();

      expect(load('/some/real/file.js')).toBeNull();
    });
  });

  describe('plugin metadata', () => {
    it('has the correct plugin name', () => {
      const { name } = makePlugin();

      expect(name).toBe('clay-vite-missing-module');
    });

    it('enforces pre', () => {
      const { enforce } = makePlugin();

      expect(enforce).toBe('pre');
    });
  });
});

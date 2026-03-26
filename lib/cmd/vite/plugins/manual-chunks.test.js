/* eslint-env jest */

'use strict';

const viteManualChunksPlugin = require('./manual-chunks');

// ── helpers ───────────────────────────────────────────────────────────────────

const CWD = '/project';

/**
 * Build a minimal Rollup moduleInfo map and return the manualChunks function
 * wired to it, plus a helper to call it by module id.
 *
 * Each entry in `modules` is:
 *   { id, isEntry, isDynamicEntry, importers, code }
 */
function makeChunker(modules, minSize) {
  const map = new Map(modules.map(m => [m.id, m]));
  const manualChunks = viteManualChunksPlugin(minSize, CWD);
  const getModuleInfo = id => map.get(id) || null;
  const chunk = id => manualChunks(id, { getModuleInfo });

  return { chunk, getModuleInfo };
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe('viteManualChunksPlugin', () => {
  describe('Rule 1 — entry modules are always their own chunk', () => {
    it('returns undefined for static entry modules', () => {
      const { chunk } = makeChunker([
        { id: '/project/bootstrap.js', isEntry: true, isDynamicEntry: false, importers: [], code: '' },
      ]);

      expect(chunk('/project/bootstrap.js')).toBeUndefined();
    });

    it('returns undefined for dynamic entry modules (component client.js)', () => {
      const { chunk } = makeChunker([
        { id: '/project/components/nav/client.js', isEntry: false, isDynamicEntry: true, importers: [], code: '' },
      ]);

      expect(chunk('/project/components/nav/client.js')).toBeUndefined();
    });
  });

  describe('Rule 2 — private deps are inlined into their owner entry', () => {
    it('inlines a small module with exactly one importer', () => {
      const entryId = '/project/components/nav/client.js';
      const depId   = '/project/components/nav/helper.js';
      const smallCode = 'x'.repeat(100);

      const { chunk } = makeChunker([
        { id: entryId, isEntry: false, isDynamicEntry: true, importers: [], code: 'entry' },
        { id: depId,   isEntry: false, isDynamicEntry: false, importers: [entryId], code: smallCode },
      ], 8192);

      const result = chunk(depId);

      expect(result).toBe('components/nav/client');
    });

    it('does NOT inline a module whose code exceeds the size threshold', () => {
      const entryId  = '/project/components/nav/client.js';
      const depId    = '/project/lib/big-dep.js';
      const bigCode  = 'x'.repeat(20000);

      const { chunk } = makeChunker([
        { id: entryId, isEntry: false, isDynamicEntry: true, importers: [], code: 'entry' },
        { id: depId,   isEntry: false, isDynamicEntry: false, importers: [entryId], code: bigCode },
      ], 8192);

      expect(chunk(depId)).toBeUndefined();
    });

    it('does NOT inline when manualChunksMinSize is 0 (native split mode)', () => {
      const entryId = '/project/components/nav/client.js';
      const depId   = '/project/components/nav/helper.js';

      const { chunk } = makeChunker([
        { id: entryId, isEntry: false, isDynamicEntry: true, importers: [], code: 'entry' },
        { id: depId,   isEntry: false, isDynamicEntry: false, importers: [entryId], code: 'small' },
      ], 0);

      expect(chunk(depId)).toBeUndefined();
    });

    it('walks up multi-level importer chain to find the owning entry', () => {
      const entryId = '/project/components/nav/client.js';
      const mid     = '/project/components/nav/utils.js';
      const leaf    = '/project/components/nav/format.js';

      const { chunk } = makeChunker([
        { id: entryId, isEntry: false, isDynamicEntry: true, importers: [],       code: 'entry' },
        { id: mid,     isEntry: false, isDynamicEntry: false, importers: [entryId], code: 'mid' },
        { id: leaf,    isEntry: false, isDynamicEntry: false, importers: [mid],     code: 'leaf' },
      ], 8192);

      expect(chunk(leaf)).toBe('components/nav/client');
    });
  });

  describe('Rule 3 — shared modules get their own Rollup chunk', () => {
    it('returns undefined for a module with multiple importers (shared)', () => {
      const entry1  = '/project/components/a/client.js';
      const entry2  = '/project/components/b/client.js';
      const sharedId = '/project/lib/shared.js';

      const { chunk } = makeChunker([
        { id: entry1,   isEntry: false, isDynamicEntry: true, importers: [],               code: 'e1' },
        { id: entry2,   isEntry: false, isDynamicEntry: true, importers: [],               code: 'e2' },
        { id: sharedId, isEntry: false, isDynamicEntry: false, importers: [entry1, entry2], code: 'shared' },
      ], 8192);

      expect(chunk(sharedId)).toBeUndefined();
    });
  });

  describe('virtual module handling', () => {
    it('skips Rollup virtual modules (ids starting with \\0)', () => {
      const { chunk } = makeChunker([], 8192);

      expect(chunk('\0some-virtual-module')).toBeUndefined();
    });
  });

  describe('missing or null moduleInfo', () => {
    it('returns undefined when getModuleInfo returns null', () => {
      const { chunk } = makeChunker([], 8192);

      expect(chunk('/project/unknown.js')).toBeUndefined();
    });
  });

  describe('toChunkName — path normalization', () => {
    it('produces a relative path without extension', () => {
      const entryId = '/project/components/header/client.js';
      const depId   = '/project/components/header/helper.js';

      const { chunk } = makeChunker([
        { id: entryId, isEntry: false, isDynamicEntry: true, importers: [],      code: 'e' },
        { id: depId,   isEntry: false, isDynamicEntry: false, importers: [entryId], code: 'small' },
      ], 8192);

      const result = chunk(depId);

      expect(result).toBe('components/header/client');
      expect(result).not.toContain('.js');
    });
  });
});

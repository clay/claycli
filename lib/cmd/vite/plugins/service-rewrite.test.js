/* eslint-env jest */

'use strict';

const path = require('path');
const os   = require('os');
const fs   = require('fs');

const viteServiceRewritePlugin = require('./service-rewrite');

// ── helpers ───────────────────────────────────────────────────────────────────

/**
 * Build an on-disk directory layout and return a plugin instance bound to it.
 *
 * layout: { 'services/server/auth.js': 'content', 'services/client/auth.js': 'content', ... }
 */
function setupProject(layout) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clay-svc-test-'));

  for (const [rel, content] of Object.entries(layout)) {
    const abs = path.join(root, rel);

    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }

  const plugin = viteServiceRewritePlugin();
  const thisCtx = {
    error: (msg) => { throw new Error(msg); },
  };
  const resolveId = (id, importer) => plugin.resolveId.call(thisCtx, id, importer);

  return { root, resolveId };
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe('viteServiceRewritePlugin', () => {
  let tmpRoot;

  afterEach(() => {
    if (tmpRoot) {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
      tmpRoot = null;
    }
  });

  describe('Case 1 — explicit services/server in the import string', () => {
    it('rewrites a direct services/server import to the client counterpart', () => {
      const { root, resolveId } = setupProject({
        'components/nav/client.js':       'export default {};',
        'services/server/auth.js':        'module.exports = {};',
        'services/client/auth.js':        'module.exports = {};',
      });

      tmpRoot = root;

      const importer = path.join(root, 'components', 'nav', 'client.js');
      const result   = resolveId(path.join(root, 'services', 'server', 'auth.js'), importer);

      expect(result).toBeTruthy();
      expect(result).toContain('services');
      expect(result).toContain('client');
      expect(result).not.toContain('server');
    });

    it('throws when no client counterpart exists', () => {
      const { root, resolveId } = setupProject({
        'components/nav/client.js': 'export default {};',
        'services/server/auth.js':  'module.exports = {};',
      });

      tmpRoot = root;

      const importer = path.join(root, 'components', 'nav', 'client.js');

      expect(() => resolveId(path.join(root, 'services', 'server', 'auth.js'), importer))
        .toThrow('A server-side service must have a client-side counterpart');
    });
  });

  describe('Case 2 — relative import that resolves inside services/server/', () => {
    it('rewrites a relative import containing /server/ that resolves into services/server/', () => {
      // An importer in services/ uses a path like './server/db' which resolves
      // to services/server/db.  The plugin must rewrite it to services/client/db.
      const { root, resolveId } = setupProject({
        'services/server/db.js': 'module.exports = {};',
        'services/client/db.js': 'module.exports = {};',
        'services/index.js':     'require("./server/db");',
      });

      tmpRoot = root;

      // cwd must equal root so path.relative(cwd, resolved) yields 'services/server/...'
      const cwdSpy   = jest.spyOn(process, 'cwd').mockReturnValue(root);
      const importer = path.join(root, 'services', 'index.js');
      const result   = resolveId('./server/db', importer);

      cwdSpy.mockRestore();

      expect(result).toBeTruthy();
      expect(result).toContain('client');
      expect(result).not.toContain(path.join('services', 'server'));
    });

    it('returns null when relative import does not resolve into services/server/', () => {
      const { root, resolveId } = setupProject({
        'components/nav/client.js': 'export default {};',
        'components/nav/helper.js': 'export default {};',
      });

      tmpRoot = root;

      const importer = path.join(root, 'components', 'nav', 'client.js');

      expect(resolveId('./helper', importer)).toBeNull();
    });
  });

  describe('non-server imports pass through', () => {
    it('returns null for node_modules imports', () => {
      const plugin  = viteServiceRewritePlugin();
      const thisCtx = { error: () => {} };
      const result  = plugin.resolveId.call(thisCtx, 'lodash', '/some/importer.js');

      expect(result).toBeNull();
    });

    it('returns null when importer has query suffix stripped', () => {
      const { root, resolveId } = setupProject({
        'components/nav/helper.js': 'export default {};',
      });

      tmpRoot = root;

      const result = resolveId('./helper', path.join(root, 'components/nav/client.js?t=123'));

      expect(result).toBeNull();
    });
  });

  describe('plugin metadata', () => {
    it('has the correct plugin name', () => {
      const plugin = viteServiceRewritePlugin();

      expect(plugin.name).toBe('clay-vite-service-rewrite');
    });

    it('enforces pre', () => {
      const plugin = viteServiceRewritePlugin();

      expect(plugin.enforce).toBe('pre');
    });
  });
});

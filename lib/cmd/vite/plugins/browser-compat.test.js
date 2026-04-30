/* eslint-env jest */

'use strict';

const fs = require('fs-extra');
const os = require('os');
const path = require('path');
const viteBrowserCompatPlugin = require('./browser-compat');

// ── helpers ───────────────────────────────────────────────────────────────────

/**
 * Exercise the plugin's resolveId + load hooks for a given module id,
 * returning { resolvedId, code } so individual tests can assert on both.
 *
 * @param {string} id
 * @param {Object} [customStubs]
 * @returns {{resolvedId: (string|null), code: (string|null)}}
 */
function runPlugin(id, customStubs) {
  const plugin = viteBrowserCompatPlugin(customStubs);
  const resolved = plugin.resolveId(id);

  if (!resolved) return { resolvedId: null, code: null };

  return { resolvedId: resolved, code: plugin.load(resolved) };
}

// ── resolveId ─────────────────────────────────────────────────────────────────

describe('viteBrowserCompatPlugin', () => {
  describe('resolveId — simple stubs', () => {
    const SIMPLE_BUILTINS = [
      'assert', 'child_process', 'cluster', 'crypto', 'dgram', 'dns',
      'domain', 'fs', 'module', 'net', 'os', 'path', 'perf_hooks',
      'punycode', 'querystring', 'readline', 'repl', 'string_decoder', 'sys',
      'timers', 'tls', 'tty', 'url', 'v8', 'vm', 'worker_threads', 'zlib',
      'hiredis',
    ];

    it.each(SIMPLE_BUILTINS)('stubs bare built-in "%s"', (id) => {
      const { resolvedId } = runPlugin(id);

      expect(resolvedId).not.toBeNull();
      expect(resolvedId).toContain('simple:');
    });

    it.each([
      'node:path', 'node:fs', 'node:os', 'node:crypto', 'node:url',
      'node:stream', 'node:events', 'node:util', 'node:buffer',
    ])('stubs node:-prefixed built-in "%s"', (id) => {
      const { resolvedId } = runPlugin(id);

      expect(resolvedId).not.toBeNull();
      expect(resolvedId).toContain('simple:');
    });

    it('loads an empty ESM namespace for simple stubs', () => {
      const { code } = runPlugin('fs');

      expect(code).toBe('export default {}; export {};');
    });
  });

  describe('resolveId — rich stubs', () => {
    const RICH_MODS = ['events', 'stream', 'util', 'buffer', 'http', 'https', 'node-fetch'];

    it.each(RICH_MODS)('stubs rich module "%s"', (id) => {
      const { resolvedId } = runPlugin(id);

      expect(resolvedId).not.toBeNull();
      expect(resolvedId).toContain('rich:');
    });

    it('returns null for unknown npm packages', () => {
      const { resolvedId } = runPlugin('lodash');

      expect(resolvedId).toBeNull();
    });

    it('returns null for relative imports', () => {
      const { resolvedId } = runPlugin('./some-local-file');

      expect(resolvedId).toBeNull();
    });
  });

  describe('load — rich stub content', () => {
    it('events stub exports EventEmitter as default and named', () => {
      const { code } = runPlugin('events');

      expect(code).toContain('function EventEmitter');
      expect(code).toContain('export default EventEmitter');
      expect(code).toContain('export { EventEmitter }');
    });

    it('events stub implements on/off/emit/once', () => {
      const { code } = runPlugin('events');

      expect(code).toContain('.on =');
      expect(code).toContain('.emit =');
      expect(code).toContain('.once =');
      expect(code).toContain('.removeListener =');
    });

    it('stream stub exports Readable, Writable, Transform, Duplex, PassThrough', () => {
      const { code } = runPlugin('stream');

      expect(code).toContain('export var Readable');
      expect(code).toContain('export var Writable');
      expect(code).toContain('export var Transform');
      expect(code).toContain('export var Duplex');
      expect(code).toContain('export var PassThrough');
    });

    it('util stub exports inherits, promisify, inspect', () => {
      const { code } = runPlugin('util');

      expect(code).toContain('export function inherits');
      expect(code).toContain('export function promisify');
      expect(code).toContain('export function inspect');
    });

    it('buffer stub exports Buffer', () => {
      const { code } = runPlugin('buffer');

      expect(code).toContain('export var Buffer');
    });

    it('http stub exports request and get', () => {
      const { code } = runPlugin('http');

      expect(code).toContain('export var request');
      expect(code).toContain('export var get');
    });

    it('https resolves to the same stub as http', () => {
      const { code: http } = runPlugin('http');
      const { code: https } = runPlugin('https');

      expect(https).toBe(http);
    });

    it('node-fetch stub delegates to globalThis.fetch', () => {
      const { code } = runPlugin('node-fetch');

      expect(code).toContain('globalThis.fetch');
    });
  });

  describe('custom stubs (site-specific overrides)', () => {
    it('custom null stub → empty object namespace', () => {
      const { resolvedId, code } = runPlugin('ioredis', { ioredis: null });

      expect(resolvedId).toContain('custom:ioredis');
      expect(code).toBe('export default {}; export {};');
    });

    it('custom string stub → emitted verbatim', () => {
      const customSrc = 'export default { connect: function() {} };';
      const { resolvedId, code } = runPlugin('mongodb', { mongodb: customSrc });

      expect(resolvedId).toContain('custom:mongodb');
      expect(code).toBe(customSrc);
    });

    it('custom stub takes precedence over built-in simple stub for the same name', () => {
      const customSrc = 'export default "custom-fs";';
      const { resolvedId, code } = runPlugin('fs', { fs: customSrc });

      expect(resolvedId).toContain('custom:fs');
      expect(code).toBe(customSrc);
    });

    it('custom stub resolves via bare name even when node: prefix is used', () => {
      const { resolvedId } = runPlugin('node:ioredis', { ioredis: null });

      expect(resolvedId).not.toBeNull();
    });

    it('ignores a customStubs argument that is not a plain object', () => {
      expect(() => runPlugin('fs', null)).not.toThrow();
      expect(() => runPlugin('fs', 'bad')).not.toThrow();
    });
  });

  describe('load — edge cases', () => {
    it('returns null for ids that do not start with the virtual prefix', () => {
      const plugin = viteBrowserCompatPlugin();

      expect(plugin.load('/some/real/file.js')).toBeNull();
    });

    it('resolveId returns null for non-built-in bare strings', () => {
      const plugin = viteBrowserCompatPlugin();

      expect(plugin.resolveId('react')).toBeNull();
      expect(plugin.resolveId('express')).toBeNull();
    });
  });

  describe('browser field false mappings', () => {
    let tmpDir;

    beforeEach(async () => {
      tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'clay-browser-field-'));
    });

    afterEach(async () => {
      if (tmpDir) await fs.remove(tmpDir);
      tmpDir = null;
    });

    it('stubs bare imports mapped to false in package.json browser field', async () => {
      const pkgDir = path.join(tmpDir, 'pkg');
      const importer = path.join(pkgDir, 'lib', 'index.js');

      await fs.ensureDir(path.dirname(importer));
      await fs.writeFile(path.join(pkgDir, 'package.json'), JSON.stringify({
        name: 'pkg',
        browser: { fs: false },
      }));
      await fs.writeFile(importer, '// importer');

      const plugin = viteBrowserCompatPlugin();
      const resolved = plugin.resolveId('fs', importer);

      expect(resolved).toContain('simple:fs');
      expect(plugin.load(resolved)).toBe('export default {}; export {};');
    });

    it('stubs relative imports mapped to false in package.json browser field', async () => {
      const pkgDir = path.join(tmpDir, 'pkg');
      const importer = path.join(pkgDir, 'lib', 'css-syntax-error.js');

      await fs.ensureDir(path.join(pkgDir, 'lib'));
      await fs.writeFile(path.join(pkgDir, 'package.json'), JSON.stringify({
        name: 'pkg',
        browser: { './lib/terminal-highlight': false },
      }));
      await fs.writeFile(importer, '// importer');

      const plugin = viteBrowserCompatPlugin();
      const resolved = plugin.resolveId('./terminal-highlight', importer);

      expect(resolved).toContain('simple:./terminal-highlight');
      expect(plugin.load(resolved)).toBe('export default {}; export {};');
    });
  });

  describe('lenient externalize mode', () => {
    it('replaces Vite browser-external proxy ids with empty module when enabled', () => {
      const plugin = viteBrowserCompatPlugin({}, { lenientExternalize: true });

      expect(plugin.load('__vite-browser-external')).toBe('export default {}; export {};');
      expect(plugin.load('__vite-browser-external:fs')).toBe('export default {}; export {};');
    });

    it('does not intercept Vite browser-external ids when disabled', () => {
      const plugin = viteBrowserCompatPlugin({}, { lenientExternalize: false });

      expect(plugin.load('__vite-browser-external')).toBeNull();
      expect(plugin.load('__vite-browser-external:fs')).toBeNull();
    });
  });

  describe('plugin metadata', () => {
    it('has the correct plugin name', () => {
      const plugin = viteBrowserCompatPlugin();

      expect(plugin.name).toBe('clay-vite-browser-compat');
    });

    it('enforces pre so it fires before Vite\'s resolver', () => {
      const plugin = viteBrowserCompatPlugin();

      expect(plugin.enforce).toBe('pre');
    });
  });
});

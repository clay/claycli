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

/**
 * Execute one of the hand-written ESM stub strings in a sandbox and return its
 * exports. The `globalThis` seen by the stub is fully controllable so tests can
 * exercise the browser path (no real global Buffer) rather than Node's built-in.
 *
 * Only the minimal export forms used by the stubs in this file are supported:
 * `export default X`, `export var NAME = X`, and `export function NAME(...)`.
 *
 * @param {string} code - the ESM stub source returned by plugin.load()
 * @param {Object} globalStub - object substituted for `globalThis` inside the stub
 * @returns {Object} the collected exports (default under `.default`)
 */
function evalEsmStub(code, globalStub) {
  const registrations = [];
  const body = code
    .replace(/export default /g, '__exports.default = ')
    .replace(/export function (\w+)/g, (_m, name) => { registrations.push(name); return `function ${name}`; })
    .replace(/export var (\w+) =/g, (_m, name) => { registrations.push(name); return `var ${name} =`; })
    + '\n' + registrations.map(n => `__exports.${n} = ${n};`).join('\n');

  const __exports = {};
  // eslint-disable-next-line no-new-func
  const fn = new Function('__exports', 'globalThis', body);

  fn(__exports, globalStub);

  return __exports;
}

// ── resolveId ─────────────────────────────────────────────────────────────────

describe('viteBrowserCompatPlugin', () => {
  describe('resolveId — simple stubs', () => {
    const SIMPLE_BUILTINS = [
      'assert', 'child_process', 'cluster', 'crypto', 'dgram', 'dns',
      'domain', 'fs', 'module', 'net', 'os', 'path', 'perf_hooks',
      'punycode', 'querystring', 'readline', 'repl', 'sys',
      'timers', 'tls', 'tty', 'v8', 'vm', 'worker_threads', 'zlib',
      'hiredis',
    ];

    it.each(SIMPLE_BUILTINS)('stubs bare built-in "%s"', (id) => {
      const { resolvedId } = runPlugin(id);

      expect(resolvedId).not.toBeNull();
      expect(resolvedId).toContain('simple:');
    });

    it.each([
      'node:path', 'node:fs', 'node:os', 'node:crypto', 'node:assert', 'node:zlib',
    ])('stubs node:-prefixed simple built-in "%s"', (id) => {
      const { resolvedId } = runPlugin(id);

      expect(resolvedId).not.toBeNull();
      expect(resolvedId).toContain('simple:');
    });

    // node:-prefixed rich built-ins must route to the rich stub, not an empty one.
    // Otherwise a library subclassing e.g. node:buffer's Buffer crashes at module
    // evaluation — the same class of bug as the safe-buffer #253 crash.
    it.each([
      'node:buffer', 'node:stream', 'node:events', 'node:util',
      'node:http', 'node:https', 'node:url',
    ])('routes node:-prefixed rich built-in "%s" to the rich stub', (id) => {
      const { resolvedId } = runPlugin(id);

      expect(resolvedId).not.toBeNull();
      expect(resolvedId).toContain('rich:');
    });

    it('loads an empty ESM namespace for simple stubs', () => {
      const { code } = runPlugin('fs');

      expect(code).toBe('export default {}; export {};');
    });
  });

  describe('resolveId — rich stubs', () => {
    const RICH_MODS = ['events', 'stream', 'util', 'buffer', 'string_decoder', 'http', 'https', 'node-fetch', 'url'];

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

    // safe-buffer feature-detects from/alloc/allocUnsafe/allocUnsafeSlow and only
    // re-exports the module (instead of subclassing Buffer) when all four exist.
    // Missing any one drops it into the Object.create(Buffer.prototype) branch.
    it('buffer stub exposes the full allocation API safe-buffer feature-detects', () => {
      const { code } = runPlugin('buffer');

      expect(code).toContain('from');
      expect(code).toContain('alloc');
      expect(code).toContain('allocUnsafe');
      expect(code).toContain('allocUnsafeSlow');
    });

    // Regression guard for the kiln-edit crash: with no global Buffer polyfill the
    // fallback Buffer must still be a function with a real prototype, so a library
    // doing `SafeBuffer.prototype = Object.create(Buffer.prototype)` does not throw
    // "Object prototype may only be an Object or null: undefined" at module eval.
    it('buffer fallback Buffer is subclass-safe when no global Buffer exists', () => {
      const { code } = runPlugin('buffer');
      const exports = evalEsmStub(code, {}); // browser path: globalThis has no Buffer
      const Buffer = exports.default.Buffer;

      expect(typeof Buffer).toBe('function');
      expect(typeof Buffer.prototype).toBe('object');
      expect(() => Object.create(Buffer.prototype)).not.toThrow();
      // Mirror safe-buffer's line-12 check — all four must be truthy.
      expect(Boolean(Buffer.from && Buffer.alloc && Buffer.allocUnsafe && Buffer.allocUnsafeSlow)).toBe(true);
    });

    it('buffer stub prefers a real global Buffer polyfill when present', () => {
      const { code } = runPlugin('buffer');
      const realish = function Buffer() {};

      realish.from = realish.alloc = realish.allocUnsafe = realish.allocUnsafeSlow = () => {};
      const exports = evalEsmStub(code, { Buffer: realish });

      expect(exports.default.Buffer).toBe(realish);
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

    it('url stub exports URL and URLSearchParams', () => {
      const { code } = runPlugin('url');

      expect(code).toContain('export var URL');
      expect(code).toContain('export var URLSearchParams');
    });

    it('url stub prefers the real global URL/URLSearchParams when present', () => {
      const { code } = runPlugin('url');
      const FakeURL = function URL() {};
      const FakeUSP = function URLSearchParams() {};
      const exports = evalEsmStub(code, { URL: FakeURL, URLSearchParams: FakeUSP });

      expect(exports.URL).toBe(FakeURL);
      expect(exports.URLSearchParams).toBe(FakeUSP);
    });

    it('url fallback URL/URLSearchParams are function-shaped when no global exists', () => {
      const { code } = runPlugin('url');
      const exports = evalEsmStub(code, {}); // browser path: no global URL

      expect(typeof exports.URL).toBe('function');
      expect(typeof exports.URLSearchParams).toBe('function');
      expect(() => Object.create(exports.URL.prototype)).not.toThrow();
    });

    // cipher-base (crypto-browserify → create-hash/createHmac) constructs a
    // StringDecoder inside .digest(enc); an empty stub throws "not a constructor".
    // The decoder delegates to the buffer's own toString(encoding).
    it('string_decoder stub exposes a constructable StringDecoder that decodes via Buffer.toString', () => {
      const { code } = runPlugin('string_decoder');
      const exports = evalEsmStub(code, {});
      const StringDecoder = exports.StringDecoder;

      expect(typeof StringDecoder).toBe('function');

      const fakeBuf = { toString: enc => `decoded:${enc}` };
      const decoder = new StringDecoder('hex');

      expect(decoder.write(fakeBuf)).toBe('decoded:hex');
      expect(decoder.end()).toBe('');
    });

    // Regression: node:buffer must load the function-shaped buffer stub, never an
    // empty one — an empty node:buffer stub reintroduces the #253 subclass crash.
    it('node:buffer loads the function-shaped buffer stub, not an empty stub', () => {
      const { code } = runPlugin('node:buffer');

      expect(code).toContain('export var Buffer');
      expect(code).not.toBe('export default {}; export {};');
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

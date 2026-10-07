/* eslint-env jest */

'use strict';

const vm = require('vm');
const viteChunkRetryPlugin = require('./chunk-retry');
const { normalizeOptions, PRELOAD_HELPER_ID } = viteChunkRetryPlugin;

// Same shape as the module Vite's build-import-analysis plugin generates for
// \0vite/preload-helper.js (vite 5.4): helper-scope consts plus the export.
const VITE_HELPER = [
  'const scriptRel = "modulepreload";',
  'const assetsURL = function(dep, importerUrl) { return new URL(dep, importerUrl).href };',
  'const seen = {};',
  'export const __vitePreload = function preload(baseModule, deps, importerUrl) { return baseModule(); }',
].join('');

function transformHelper(options) {
  const plugin = viteChunkRetryPlugin(options);
  const warn = jest.fn();
  const result = plugin.transform.call({ warn }, VITE_HELPER, PRELOAD_HELPER_ID);

  return { plugin, result, warn };
}

// ── option handling ───────────────────────────────────────────────────────────

describe('chunk-retry plugin', () => {
  describe('normalizeOptions', () => {
    it('uses defaults when nothing is given', () => {
      expect(normalizeOptions()).toEqual({ attempts: 3, delay: 300 });
      expect(normalizeOptions({})).toEqual({ attempts: 3, delay: 300 });
      expect(normalizeOptions(null)).toEqual({ attempts: 3, delay: 300 });
    });

    it('accepts valid overrides', () => {
      expect(normalizeOptions({ attempts: 5, delay: 50 })).toEqual({ attempts: 5, delay: 50 });
      expect(normalizeOptions({ attempts: 1, delay: 0 })).toEqual({ attempts: 1, delay: 0 });
    });

    it('falls back to defaults for invalid values', () => {
      expect(normalizeOptions({ attempts: 0, delay: -1 })).toEqual({ attempts: 3, delay: 300 });
      expect(normalizeOptions({ attempts: 2.5, delay: NaN })).toEqual({ attempts: 3, delay: 300 });
      expect(normalizeOptions({ attempts: 99, delay: 999999 })).toEqual({ attempts: 3, delay: 300 });
      expect(normalizeOptions({ attempts: '4', delay: '10' })).toEqual({ attempts: 3, delay: 300 });
    });
  });

  // ── plugin shape ────────────────────────────────────────────────────────────

  describe('plugin shape', () => {
    it('is a build-only plugin named clay-vite-chunk-retry', () => {
      const plugin = viteChunkRetryPlugin();

      expect(plugin.name).toBe('clay-vite-chunk-retry');
      expect(plugin.apply).toBe('build');
    });
  });

  // ── transform ───────────────────────────────────────────────────────────────

  describe('transform', () => {
    it('ignores every module except Vite’s preload helper', () => {
      const plugin = viteChunkRetryPlugin();
      const warn = jest.fn();

      expect(plugin.transform.call({ warn }, VITE_HELPER, '/src/components/a/client.js')).toBeNull();
      expect(warn).not.toHaveBeenCalled();
    });

    it('renames the original export and appends the retry wrapper', () => {
      const { result, warn } = transformHelper({ attempts: 4, delay: 120 });

      expect(warn).not.toHaveBeenCalled();
      expect(result.map).toBeNull();
      expect(result.code).toContain('const __clayOriginalPreload = function preload(');
      expect(result.code).toContain('export const __vitePreload = function preloadWithRetry(');
      // exactly one export of __vitePreload, so importers still resolve it
      expect(result.code.match(/export const __vitePreload =/g)).toHaveLength(1);
      expect(result.code).toContain('var __clayRetry = {"attempts":4,"delay":120};');
    });

    it('warns and leaves the helper untouched when Vite changes its shape', () => {
      const plugin = viteChunkRetryPlugin();
      const warn = jest.fn();
      const result = plugin.transform.call({ warn }, 'export function __vitePreload() {}', PRELOAD_HELPER_ID);

      expect(result).toBeNull();
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toMatch(/unrecognised Vite preload helper/);
    });
  });

  // ── config hook ─────────────────────────────────────────────────────────────

  describe('config', () => {
    function resolver(userConfig) {
      const patch = viteChunkRetryPlugin().config(userConfig);

      return patch && patch.build.modulePreload.resolveDependencies;
    }

    it('adds the chunk itself when Vite would pass no dependencies', () => {
      const resolve = resolver({ build: { modulePreload: { polyfill: false } } });

      expect(resolve('js/chunks/c-1.js', [], { hostType: 'js', hostId: 'js/main.js' })).toEqual(['js/chunks/c-1.js']);
    });

    it('leaves a non-empty dependency list alone', () => {
      const resolve = resolver({});
      const deps = ['js/chunks/a-1.js', 'js/chunks/shared-1.js'];

      expect(resolve('js/chunks/a-1.js', deps, { hostType: 'js', hostId: 'js/main.js' })).toBe(deps);
    });

    it('does not touch HTML preloads', () => {
      const resolve = resolver({});

      expect(resolve('js/main.js', [], { hostType: 'html', hostId: 'index.html' })).toEqual([]);
    });

    it('composes with a resolveDependencies the user already set', () => {
      const existing = jest.fn().mockReturnValue([]);
      const resolve = resolver({ build: { modulePreload: { resolveDependencies: existing } } });
      const context = { hostType: 'js', hostId: 'js/main.js' };

      expect(resolve('js/chunks/c-1.js', ['x.js'], context)).toEqual(['js/chunks/c-1.js']);
      expect(existing).toHaveBeenCalledWith('js/chunks/c-1.js', ['x.js'], context);
    });

    it('stays out of the way when module preloading is disabled', () => {
      expect(viteChunkRetryPlugin().config({ build: { modulePreload: false } })).toBeNull();
    });
  });

  // ── browser runtime ─────────────────────────────────────────────────────────

  describe('runtime (evaluated against a fake browser)', () => {
    const IMPORTER = 'https://assets.test/js/main.js';

    // Run the transformed helper in a sandbox and return its __vitePreload plus
    // the fakes it talks to.  setTimeout is immediate but records the delay so
    // backoff can be asserted without waiting.
    function load(responses, options, env = {}) {
      const { result } = transformHelper(options);
      const code = result.code.replace('export const __vitePreload =', 'var __vitePreload =');
      const delays = [];
      const listeners = {};
      const calls = [];
      const queue = Object.assign({}, responses);
      const fetchFake = jest.fn(url => {
        calls.push(url);

        const list = queue[url] || [{ status: 200 }];
        const next = list.length > 1 ? list.shift() : list[0];

        if (next.reject) return Promise.reject(new TypeError('Failed to fetch'));

        return Promise.resolve({
          ok: next.status >= 200 && next.status < 300,
          status: next.status,
          arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
        });
      });
      const sandbox = {
        URL,
        Promise,
        Math,
        Error,
        TypeError,
        ArrayBuffer,
        console: { debug: jest.fn(), warn: jest.fn() },
        document: { addEventListener: (type, fn) => { listeners[type] = fn; } },
        setTimeout: (fn, ms) => { delays.push(ms); Promise.resolve().then(fn); },
        fetch: env.noFetch ? undefined : fetchFake,
      };

      vm.runInNewContext(code, sandbox);

      return { preload: sandbox.__vitePreload, sandbox, calls, delays, listeners, fetchFake };
    }

    const base = jest.fn();

    beforeEach(() => {
      base.mockReset().mockResolvedValue({ default: 'component' });
    });

    it('fetches every JS dependency before running the original import', async () => {
      const { preload, calls } = load({});
      const out = await preload(base, ['chunks/a-1.js', 'chunks/shared-1.js'], IMPORTER);

      expect(out).toEqual({ default: 'component' });
      expect(calls).toEqual([
        'https://assets.test/js/chunks/a-1.js',
        'https://assets.test/js/chunks/shared-1.js',
      ]);
      expect(base).toHaveBeenCalledTimes(1);
    });

    it('retries a transient 5xx and then succeeds', async () => {
      const url = 'https://assets.test/js/chunks/a-1.js';
      const { preload, calls, sandbox } = load({ [url]: [{ status: 503 }, { status: 200 }] });

      await preload(base, ['chunks/a-1.js'], IMPORTER);

      expect(calls).toEqual([url, url]);
      expect(base).toHaveBeenCalledTimes(1);
      expect(sandbox.console.debug).toHaveBeenCalledWith(expect.stringContaining('after 2 attempts'));
      expect(sandbox.console.warn).not.toHaveBeenCalled();
    });

    it('retries a network error', async () => {
      const url = 'https://assets.test/js/chunks/a-1.js';
      const { preload, calls } = load({ [url]: [{ reject: true }, { status: 200 }] });

      await preload(base, ['chunks/a-1.js'], IMPORTER);

      expect(calls).toHaveLength(2);
      expect(base).toHaveBeenCalledTimes(1);
    });

    it.each([408, 425, 429, 500, 502, 503, 504])('treats %i as transient', async status => {
      const url = 'https://assets.test/js/chunks/a-1.js';
      const { preload, calls } = load({ [url]: [{ status }, { status: 200 }] });

      await preload(base, ['chunks/a-1.js'], IMPORTER);

      expect(calls).toHaveLength(2);
    });

    it.each([400, 401, 403, 404, 410])('does not retry %i', async status => {
      const url = 'https://assets.test/js/chunks/a-1.js';
      const { preload, calls, sandbox } = load({ [url]: [{ status }] });

      await preload(base, ['chunks/a-1.js'], IMPORTER);

      expect(calls).toHaveLength(1);
      expect(sandbox.console.warn).toHaveBeenCalledWith(expect.stringContaining('HTTP ' + status));
      // falls through to the original import, which fails on its own
      expect(base).toHaveBeenCalledTimes(1);
    });

    it('gives up after the configured attempts and still runs the original import', async () => {
      const url = 'https://assets.test/js/chunks/a-1.js';
      const { preload, calls, sandbox } = load({ [url]: [{ status: 500 }] }, { attempts: 3, delay: 100 });

      base.mockRejectedValue(new Error('Failed to fetch dynamically imported module'));

      await expect(preload(base, ['chunks/a-1.js'], IMPORTER)).rejects.toThrow(/dynamically imported/);

      expect(calls).toHaveLength(3);
      expect(sandbox.console.warn).toHaveBeenCalledWith(expect.stringContaining('HTTP 500'));
      expect(base).toHaveBeenCalledTimes(1);
    });

    it('backs off exponentially with jitter', async () => {
      const url = 'https://assets.test/js/chunks/a-1.js';
      const { preload, delays } = load({ [url]: [{ status: 500 }] }, { attempts: 3, delay: 100 });

      await preload(base, ['chunks/a-1.js'], IMPORTER);

      // each retry is preceded by a zero-length yield, then the backoff itself
      const backoffs = delays.filter(ms => ms > 0);

      expect(delays.filter(ms => ms === 0)).toHaveLength(2);
      expect(backoffs).toHaveLength(2);
      expect(backoffs[0]).toBeGreaterThanOrEqual(100);
      expect(backoffs[0]).toBeLessThanOrEqual(150);
      expect(backoffs[1]).toBeGreaterThanOrEqual(200);
      expect(backoffs[1]).toBeLessThanOrEqual(300);
    });

    it('makes one request per URL when many imports share a dependency', async () => {
      const { preload, calls } = load({});

      await Promise.all([
        preload(base, ['chunks/a-1.js', 'chunks/shared-1.js'], IMPORTER),
        preload(base, ['chunks/b-1.js', 'chunks/shared-1.js'], IMPORTER),
        preload(base, ['chunks/shared-1.js'], IMPORTER),
      ]);

      expect(calls.filter(u => u.endsWith('shared-1.js'))).toHaveLength(1);
      expect(calls).toHaveLength(3);
      expect(base).toHaveBeenCalledTimes(3);
    });

    it('does not fetch again for a chunk that already loaded', async () => {
      const { preload, calls } = load({});

      await preload(base, ['chunks/a-1.js'], IMPORTER);
      await preload(base, ['chunks/a-1.js'], IMPORTER);

      expect(calls).toHaveLength(1);
    });

    it('skips stylesheets and other non-JS dependencies', async () => {
      const { preload, calls } = load({});

      await preload(base, ['assets/style-1.css', 'chunks/a-1.js?v=2', 'img/logo.png'], IMPORTER);

      expect(calls).toEqual(['https://assets.test/js/chunks/a-1.js?v=2']);
    });

    it('passes straight through when there are no dependencies', async () => {
      const { preload, calls } = load({});

      await preload(base, [], IMPORTER);
      await preload(base, undefined, IMPORTER);

      expect(calls).toHaveLength(0);
      expect(base).toHaveBeenCalledTimes(2);
    });

    it('passes straight through when fetch is unavailable', async () => {
      const { preload } = load({}, undefined, { noFetch: true });

      await expect(preload(base, ['chunks/a-1.js'], IMPORTER)).resolves.toEqual({ default: 'component' });
    });

    it('propagates the importer URL so relative dependencies resolve like Vite’s own helper', async () => {
      const { preload, calls } = load({});

      await preload(base, ['./chunks/a-1.js'], 'https://cdn.test/site/js/bootstrap.js');

      expect(calls).toEqual(['https://cdn.test/site/js/chunks/a-1.js']);
    });

    describe('when a CSP blocks fetch', () => {
      it('stops warming after a connect-src violation', async () => {
        const urlA = 'https://assets.test/js/chunks/a-1.js';
        const { preload, calls, listeners, sandbox } = load({ [urlA]: [{ reject: true }] });

        // The first fetch fails, and the browser reports the CSP violation
        // right after, before the retry would run.
        const pending = preload(base, ['chunks/a-1.js'], IMPORTER);

        listeners.securitypolicyviolation({ violatedDirective: 'connect-src' });
        await pending;

        expect(calls).toEqual([urlA]);
        expect(sandbox.console.warn).not.toHaveBeenCalled();
        expect(base).toHaveBeenCalledTimes(1);

        await preload(base, ['chunks/b-1.js'], IMPORTER);

        expect(calls).toEqual([urlA]);
      });

      it('ignores violations of other directives', async () => {
        const { preload, calls, listeners } = load({});

        listeners.securitypolicyviolation({ violatedDirective: 'img-src' });
        await preload(base, ['chunks/a-1.js'], IMPORTER);

        expect(calls).toHaveLength(1);
      });
    });
  });
});

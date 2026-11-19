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

describe('chunk-retry plugin', () => {
  // ── option handling ─────────────────────────────────────────────────────────

  describe('normalizeOptions', () => {
    const DEFAULTS = { attempts: 3, delay: 250, timeout: 10000, maxWait: 2000 };

    let warn;

    beforeEach(() => { warn = jest.spyOn(console, 'warn').mockImplementation(() => {}); });
    afterEach(() => warn.mockRestore());

    it('uses defaults when nothing is given', () => {
      expect(normalizeOptions()).toEqual(DEFAULTS);
      expect(normalizeOptions({})).toEqual(DEFAULTS);
      expect(normalizeOptions(null)).toEqual(DEFAULTS);
      expect(warn).not.toHaveBeenCalled();
    });

    it('accepts valid overrides', () => {
      expect(normalizeOptions({ attempts: 5, delay: 50, timeout: 3000, maxWait: 900 }))
        .toEqual({ attempts: 5, delay: 50, timeout: 3000, maxWait: 900 });
      expect(normalizeOptions({ attempts: 1, delay: 0, maxWait: 0 })).toMatchObject({ attempts: 1, delay: 0, maxWait: 0 });
      expect(warn).not.toHaveBeenCalled();
    });

    it('clamps out-of-range numbers and says so', () => {
      expect(normalizeOptions({ attempts: 99, delay: 999999, timeout: 5, maxWait: -4 }))
        .toEqual({ attempts: 10, delay: 10000, timeout: 1000, maxWait: 0 });
      expect(warn).toHaveBeenCalledTimes(4);
      expect(warn.mock.calls[0][0]).toMatch(/chunkRetry\.attempts must be between 1 and 10; using 10/);
    });

    it('falls back to the default for values that are not numbers, and says so', () => {
      expect(normalizeOptions({ attempts: 2.5, delay: NaN, timeout: '4000', maxWait: null })).toEqual(DEFAULTS);
      expect(warn).toHaveBeenCalledTimes(4);
      expect(warn.mock.calls[0][0]).toMatch(/chunkRetry\.attempts must be a whole number; using 3/);
      expect(warn.mock.calls[1][0]).toMatch(/chunkRetry\.delay must be a number; using 250/);
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
      expect(result.code).toContain('var __clayRetry = {"attempts":4,"delay":120,"timeout":10000,"maxWait":2000};');
    });

    it('warns and leaves the helper untouched when Vite changes its shape', () => {
      const plugin = viteChunkRetryPlugin();
      const warn = jest.fn();
      const result = plugin.transform.call({ warn }, 'export function __vitePreload() {}', PRELOAD_HELPER_ID);

      expect(result).toBeNull();
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toMatch(/unrecognised Vite preload helper/);
    });

    it('does nothing when module preloading is switched off', () => {
      const plugin = viteChunkRetryPlugin();
      const warn = jest.fn();

      expect(plugin.config({ build: { modulePreload: false } })).toBeNull();
      expect(plugin.transform.call({ warn }, VITE_HELPER, PRELOAD_HELPER_ID)).toBeNull();
      expect(warn).not.toHaveBeenCalled();
    });
  });

  // ── config hook ─────────────────────────────────────────────────────────────

  describe('config', () => {
    function resolver(userConfig, resolved) {
      const plugin = viteChunkRetryPlugin();
      const patch = plugin.config(userConfig);

      if (resolved) plugin.configResolved(resolved);

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

    it('does not name chunks Vite may have removed when CSS is split', () => {
      const split = resolver({}, { build: { cssCodeSplit: true } });
      const joined = resolver({}, { build: { cssCodeSplit: false } });
      const context = { hostType: 'js', hostId: 'js/main.js' };

      expect(split('js/chunks/css-only-1.js', [], context)).toEqual([]);
      expect(joined('js/chunks/c-1.js', [], context)).toEqual(['js/chunks/c-1.js']);
    });
  });

  // ── browser runtime ─────────────────────────────────────────────────────────

  describe('runtime (evaluated against a fake browser)', () => {
    const IMPORTER = 'https://assets.test/js/main.js';
    const A = 'https://assets.test/js/chunks/a-1.js';

    // Run the transformed helper in a sandbox and return its __vitePreload plus
    // the fakes it talks to.  Timers at or above one second are the abort timer:
    // they wait until fireAbortTimers().  Shorter ones are backoff sleeps, which
    // run at once but record the delay, so retries need no real waiting.
    function load(responses, options, env = {}) {
      const { result } = transformHelper(options);
      const code = result.code.replace('export const __vitePreload =', 'var __vitePreload =');
      const delays = [];
      const abortTimers = new Map();
      const listeners = {};
      const calls = [];
      const inits = [];
      const queue = Object.assign({}, responses);

      let nextTimer = 1;

      const fetchFake = jest.fn((url, init) => {
        calls.push(url);
        inits.push(init);

        const list = queue[url] || [{ status: 200 }];
        const next = list.length > 1 ? list.shift() : list[0];

        if (next.throwSync) throw new Error('patched fetch blew up');
        if (next.reject) return Promise.reject(new TypeError('Failed to fetch'));
        if (next.stall) {
          return new Promise((resolve, reject) => {
            init.signal.addEventListener('abort', () => reject(new Error('aborted')));
          });
        }

        return Promise.resolve({
          ok: next.status >= 200 && next.status < 300,
          status: next.status,
          arrayBuffer: () => next.bodyReject ? Promise.reject(new TypeError('body failed')) : Promise.resolve(new ArrayBuffer(0)),
        });
      });

      const sandbox = {
        URL,
        Promise,
        Math,
        Date,
        Error,
        TypeError,
        ArrayBuffer,
        String,
        AbortController: env.noAbort ? undefined : AbortController,
        console: { debug: jest.fn(), warn: jest.fn() },
        document: { addEventListener: (type, fn) => { listeners[type] = fn; } },
        setTimeout: (fn, ms) => {
          const id = nextTimer++;

          if (ms >= 1000) {
            abortTimers.set(id, fn);
          } else {
            delays.push(ms);
            Promise.resolve().then(fn);
          }

          return id;
        },
        clearTimeout: id => abortTimers.delete(id),
        fetch: env.noFetch ? undefined : fetchFake,
      };

      vm.runInNewContext(code, sandbox);

      return {
        preload: sandbox.__vitePreload,
        sandbox,
        calls,
        inits,
        delays,
        listeners,
        abortTimers,
        fireAbortTimers: () => { abortTimers.forEach(fn => fn()); abortTimers.clear(); },
      };
    }

    const base = jest.fn();

    beforeEach(() => {
      base.mockReset().mockResolvedValue({ default: 'component' });
    });

    it('fetches every JS dependency before running the original import', async () => {
      const { preload, calls } = load({});
      const out = await preload(base, ['chunks/a-1.js', 'chunks/shared-1.js'], IMPORTER);

      expect(out).toEqual({ default: 'component' });
      expect(calls).toEqual([A, 'https://assets.test/js/chunks/shared-1.js']);
      expect(base).toHaveBeenCalledTimes(1);
    });

    it('asks the browser for any cached copy instead of revalidating, with an abort signal', async () => {
      const { preload, inits } = load({});

      await preload(base, ['chunks/a-1.js'], IMPORTER);

      expect(inits[0].cache).toBe('force-cache');
      expect(inits[0].signal).toBeDefined();
    });

    it('bypasses the cache on retries, so a cached failure is not handed back', async () => {
      const { preload, inits } = load({ [A]: [{ status: 503 }, { status: 503 }, { status: 200 }] });

      await preload(base, ['chunks/a-1.js'], IMPORTER);

      expect(inits.map(init => init.cache)).toEqual(['force-cache', 'reload', 'reload']);
    });

    it('stops the abort timer once response headers arrive', async () => {
      const { preload, abortTimers } = load({});

      await preload(base, ['chunks/a-1.js'], IMPORTER);

      expect(abortTimers.size).toBe(0);
    });

    it('retries a transient 5xx and then succeeds', async () => {
      const { preload, calls, sandbox } = load({ [A]: [{ status: 503 }, { status: 200 }] });

      await preload(base, ['chunks/a-1.js'], IMPORTER);

      expect(calls).toEqual([A, A]);
      expect(base).toHaveBeenCalledTimes(1);
      expect(sandbox.console.debug).toHaveBeenCalledWith(expect.stringContaining('after 2 attempts'));
      expect(sandbox.console.warn).not.toHaveBeenCalled();
    });

    it('retries a network error', async () => {
      const { preload, calls } = load({ [A]: [{ reject: true }, { status: 200 }] });

      await preload(base, ['chunks/a-1.js'], IMPORTER);

      expect(calls).toHaveLength(2);
      expect(base).toHaveBeenCalledTimes(1);
    });

    it('retries when the body fails to download', async () => {
      const { preload, calls } = load({ [A]: [{ status: 200, bodyReject: true }, { status: 200 }] });

      await preload(base, ['chunks/a-1.js'], IMPORTER);

      expect(calls).toHaveLength(2);
    });

    it('treats a fetch that throws synchronously as a failed attempt, never as a throw', async () => {
      const { preload, calls } = load({ [A]: [{ throwSync: true }, { status: 200 }] });

      let pending;

      expect(() => { pending = preload(base, ['chunks/a-1.js'], IMPORTER); }).not.toThrow();
      await pending;

      expect(calls).toHaveLength(2);
      expect(base).toHaveBeenCalledTimes(1);
    });

    it.each([408, 425, 429, 500, 502, 503, 504])('treats %i as transient', async status => {
      const { preload, calls } = load({ [A]: [{ status }, { status: 200 }] });

      await preload(base, ['chunks/a-1.js'], IMPORTER);

      expect(calls).toHaveLength(2);
    });

    it.each([400, 401, 403, 404, 410])('does not retry %i', async status => {
      const { preload, calls, sandbox } = load({ [A]: [{ status }] });

      await preload(base, ['chunks/a-1.js'], IMPORTER);

      expect(calls).toHaveLength(1);
      expect(sandbox.console.warn).toHaveBeenCalledWith(expect.stringContaining('HTTP ' + status));
      // falls through to the original import, which fails on its own
      expect(base).toHaveBeenCalledTimes(1);
    });

    it('gives up after the configured attempts and still runs the original import', async () => {
      const { preload, calls, sandbox } = load({ [A]: [{ status: 500 }] }, { attempts: 3, delay: 100 });

      base.mockRejectedValue(new Error('Failed to fetch dynamically imported module'));

      await expect(preload(base, ['chunks/a-1.js'], IMPORTER)).rejects.toThrow(/dynamically imported/);

      expect(calls).toHaveLength(3);
      expect(sandbox.console.warn).toHaveBeenCalledWith(expect.stringContaining('HTTP 500'));
      expect(base).toHaveBeenCalledTimes(1);
    });

    it('backs off exponentially with jitter', async () => {
      const { preload, delays } = load({ [A]: [{ status: 500 }] }, { attempts: 3, delay: 100 });

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

    it('stops retrying once the next backoff would pass maxWait', async () => {
      const { preload, calls, sandbox } = load({ [A]: [{ status: 500 }] }, { attempts: 5, delay: 900, maxWait: 500 });

      await preload(base, ['chunks/a-1.js'], IMPORTER);

      // the first backoff alone (at least 900 ms) is past the 500 ms budget
      expect(calls).toHaveLength(1);
      expect(sandbox.console.warn).toHaveBeenCalledWith(expect.stringContaining('HTTP 500'));
      expect(base).toHaveBeenCalledTimes(1);
    });

    it('aborts an attempt that gets no response headers and retries it', async () => {
      const { preload, calls, fireAbortTimers, sandbox } = load({ [A]: [{ stall: true }, { status: 200 }] });
      const pending = preload(base, ['chunks/a-1.js'], IMPORTER);

      await Promise.resolve();
      fireAbortTimers();
      await pending;

      expect(calls).toEqual([A, A]);
      expect(sandbox.console.debug).toHaveBeenCalledWith(expect.stringContaining('after 2 attempts'));
      expect(base).toHaveBeenCalledTimes(1);
    });

    it('falls through instead of looping when a stalled attempt leaves no budget', async () => {
      const { preload, calls, fireAbortTimers, sandbox } = load({ [A]: [{ stall: true }] }, { delay: 5000, maxWait: 100 });
      const pending = preload(base, ['chunks/a-1.js'], IMPORTER);

      await Promise.resolve();
      fireAbortTimers();
      await pending;

      expect(calls).toHaveLength(1);
      expect(sandbox.console.warn).toHaveBeenCalledWith(expect.stringContaining('no response within 10000 ms'));
      expect(base).toHaveBeenCalledTimes(1);
    });

    it('still works where AbortController does not exist', async () => {
      const { preload, calls, inits } = load({ [A]: [{ status: 503 }, { status: 200 }] }, undefined, { noAbort: true });

      await preload(base, ['chunks/a-1.js'], IMPORTER);

      expect(calls).toHaveLength(2);
      expect(inits.map(init => init.cache)).toEqual(['force-cache', 'reload']);
      expect(inits[0].signal).toBeUndefined();
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
      // The first fetch fails, and the browser reports the violation right
      // after, before the retry would run.
      async function blockedRun(violation) {
        const env = load({ [A]: [{ reject: true }] });
        const pending = env.preload(base, ['chunks/a-1.js'], IMPORTER);

        env.listeners.securitypolicyviolation(violation);
        await pending;

        return env;
      }

      it('stops warming after an enforced connect-src violation against the asset origin', async () => {
        const { preload, calls, sandbox } = await blockedRun({ violatedDirective: 'connect-src', disposition: 'enforce', blockedURI: A });

        expect(calls).toEqual([A]);
        expect(sandbox.console.warn).not.toHaveBeenCalled();
        expect(base).toHaveBeenCalledTimes(1);

        await preload(base, ['chunks/b-1.js'], IMPORTER);

        expect(calls).toEqual([A]);
      });

      it('also matches when the browser reports only the origin', async () => {
        const { calls } = await blockedRun({ violatedDirective: 'connect-src-elem', blockedURI: 'https://assets.test' });

        expect(calls).toEqual([A]);
      });

      it.each([
        ['a report-only policy', { violatedDirective: 'connect-src', disposition: 'report', blockedURI: A }],
        ['another origin’s request', { violatedDirective: 'connect-src', disposition: 'enforce', blockedURI: 'https://ads.example/beacon' }],
        ['a violation without a blocked URI', { violatedDirective: 'connect-src', disposition: 'enforce' }],
        ['another directive', { violatedDirective: 'img-src', disposition: 'enforce', blockedURI: A }],
      ])('ignores %s', async (_name, violation) => {
        const { calls } = await blockedRun(violation);

        // the retries still ran (every attempt fails in this fake)
        expect(calls).toEqual([A, A, A]);
      });
    });
  });
});

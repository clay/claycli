'use strict';

const PRELOAD_HELPER_ID = '\0vite/preload-helper.js';
const PRELOAD_EXPORT = 'export const __vitePreload =';
const ORIGINAL_PRELOAD = 'const __clayOriginalPreload =';

// fallback/min/max in ms except `attempts`, which is a count.
const OPTION_SPECS = {
  attempts: { fallback: 3, min: 1, max: 10, whole: true },
  delay: { fallback: 250, min: 0, max: 10000 },
  timeout: { fallback: 10000, min: 1000, max: 60000 },
  maxWait: { fallback: 2000, min: 0, max: 30000 },
};

/**
 * Browser-side retry runtime appended to Vite's preload helper.
 *
 * Kept as a string (like MOUNT_RUNTIME in generate-bootstrap.js) because it is
 * injected into the bundle, not executed by claycli.  Written as ES2017-safe
 * syntax, with no optional chaining or object spread, so it needs no further
 * transpiling.  `assetsURL` is defined by Vite in the helper module scope.
 *
 * `__CLAY_RETRY_OPTIONS__` is replaced with the JSON options object.
 */
const RETRY_RUNTIME = `
var __clayRetry = __CLAY_RETRY_OPTIONS__;
var __clayWarmed = {};
var __clayOrigins = {};
var __clayCspBlocked = false;

// An enforced CSP without this site's asset host in connect-src makes every
// warm-up fetch fail, which would add a pointless retry delay to every chunk.
// The browser reports that as a violation against the chunk's origin, so stop
// warming and let import() load chunks as before.  Report-only policies block
// nothing, and a violation against some other origin (a third-party beacon) says
// nothing about our fetches, so neither trips the switch.
if (typeof document !== 'undefined' && document.addEventListener) {
  document.addEventListener('securitypolicyviolation', function (e) {
    if (e.disposition === 'report' || String(e.violatedDirective || '').indexOf('connect-src') !== 0) return;

    var blocked = String(e.blockedURI || '');

    for (var origin in __clayOrigins) {
      if (blocked.indexOf(origin) === 0) {
        __clayCspBlocked = true;
        return;
      }
    }
  });
}

function __claySleep(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

// 5xx and the "try again" 4xx statuses can succeed on a second request.  404
// and 403 mean the file is gone (typically a deploy replaced the chunk), and no
// number of retries brings it back.
function __clayIsTransient(status) {
  return status >= 500 || status === 408 || status === 425 || status === 429;
}

// One request for a chunk.  The first attempt uses force-cache: any copy the
// browser already holds is used, stale or not, so a chunk the page has loaded
// already is never revalidated (a stalled revalidation would otherwise block an
// import that was going to succeed); a miss goes to the network as usual.
// Retries use reload instead, because the browser may have cached the failed
// response and force-cache would hand that same failure straight back.  If no
// response headers arrive within the timeout the request is aborted: an
// unanswered request would otherwise hold the browser's cache lock for that URL
// and block the import() that follows.  The timer stops once headers arrive, so
// a slow body is left alone.
function __clayFetchChunk(url, retrying) {
  var controller = typeof AbortController === 'function' ? new AbortController() : null;
  var timedOut = false;
  var timer = controller ? setTimeout(function () { timedOut = true; controller.abort(); }, __clayRetry.timeout) : 0;
  var init = { cache: retrying ? 'reload' : 'force-cache' };

  if (controller) init.signal = controller.signal;

  // Start inside a promise so a patched fetch that throws synchronously is
  // still just a rejected attempt.
  return Promise.resolve().then(function () { return fetch(url, init); }).then(function (res) {
    clearTimeout(timer);

    if (!res.ok) {
      var err = new Error('HTTP ' + res.status);

      err.transient = __clayIsTransient(res.status);
      throw err;
    }
    // Read the whole body so the response is complete (and cached) before
    // import() asks for the same URL.
    return res.arrayBuffer();
  }, function (err) {
    clearTimeout(timer);

    if (timedOut) {
      err = new Error('no response within ' + __clayRetry.timeout + ' ms');
      err.transient = true;
    }
    throw err;
  });
}

// Resolves once the chunk is known to be fetchable, or once we give up.  Never
// rejects: after giving up the original preload runs, which fails exactly as it
// did before this wrapper existed.  Results are shared per URL so a chunk that
// many components depend on is retried once, not once per component.  The
// bootstrap waits for every component before mounting any, so the whole retry
// is bounded by maxWait: one chunk that stays down delays the page by at most
// that long.
function __clayWarmChunk(url) {
  if (__clayCspBlocked) return Promise.resolve();
  if (__clayWarmed[url]) return __clayWarmed[url];

  var started = Date.now();

  try { __clayOrigins[new URL(url).origin] = true; } catch (e) { /* not a URL: nothing to match */ }

  function giveUp(err) {
    console.warn('[clay vite] chunk request failed (' + (err && err.message) + '): ' + url);
  }

  function attempt(n) {
    return __clayFetchChunk(url, n > 1).then(function () {
      if (n > 1) console.debug('[clay vite] chunk loaded after ' + n + ' attempts: ' + url);
    }, function (err) {
      if ((err && err.transient === false) || n >= __clayRetry.attempts) return giveUp(err);

      // The CSP violation event is queued as its own task, so it can arrive a
      // moment after this rejection.  Yield once before deciding to retry.
      return __claySleep(0).then(function () {
        if (__clayCspBlocked) return;

        var backoff = __clayRetry.delay * Math.pow(2, n - 1) * (1 + Math.random() * 0.5);

        if (Date.now() - started + backoff > __clayRetry.maxWait) return giveUp(err);

        return __claySleep(backoff).then(function () {
          return __clayCspBlocked ? undefined : attempt(n + 1);
        });
      });
    });
  }

  __clayWarmed[url] = attempt(1);

  return __clayWarmed[url];
}

function __clayWarmDeps(deps, importerUrl) {
  if (typeof fetch !== 'function' || !deps || !deps.length) return Promise.resolve();

  var pending = [];

  for (var i = 0; i < deps.length; i++) {
    var url;

    try { url = assetsURL(deps[i], importerUrl); } catch (e) { continue; }
    if (/\\.m?js([?#]|$)/.test(url)) pending.push(__clayWarmChunk(url));
  }

  return Promise.all(pending).catch(function () {});
}

export const __vitePreload = function preloadWithRetry(baseModule, deps, importerUrl) {
  return __clayWarmDeps(deps, importerUrl).then(function () {
    return __clayOriginalPreload(baseModule, deps, importerUrl);
  });
};
`;

/**
 * Validate one option: keep it when it is a finite number in range, clamp it
 * when it is out of range, and use the default for anything that is not a
 * number.  Anything adjusted is reported once at build time.
 *
 * @param {string} name   option key
 * @param {*}      value  value from bundlerConfig().chunkRetry
 * @returns {number}
 */
function resolveOption(name, value) {
  const spec = OPTION_SPECS[name];

  if (value === undefined) return spec.fallback;

  if (typeof value !== 'number' || !Number.isFinite(value) || spec.whole && !Number.isInteger(value)) {
    console.warn(`[clay vite] chunkRetry.${name} must be ${spec.whole ? 'a whole ' : 'a '}number; using ${spec.fallback}.`);

    return spec.fallback;
  }

  const clamped = Math.min(spec.max, Math.max(spec.min, value));

  if (clamped !== value) {
    console.warn(`[clay vite] chunkRetry.${name} must be between ${spec.min} and ${spec.max}; using ${clamped}.`);
  }

  return clamped;
}

/**
 * Coerce user options to safe values.
 *
 * @param {object} [options]
 * @param {number} [options.attempts=3]    total tries per chunk (1 still adds one fetch per chunk)
 * @param {number} [options.delay=250]     base backoff in ms, doubled per retry, plus up to 50% jitter
 * @param {number} [options.timeout=10000] ms to wait for response headers before aborting an attempt
 * @param {number} [options.maxWait=2000]  ms after which a chunk's retrying stops, whatever attempts remain
 * @returns {{attempts: number, delay: number, timeout: number, maxWait: number}}
 */
function normalizeOptions(options) {
  const opts = options && typeof options === 'object' ? options : {};

  return Object.keys(OPTION_SPECS).reduce((out, name) => {
    out[name] = resolveOption(name, opts[name]);

    return out;
  }, {});
}

/**
 * Vite plugin that retries transient chunk-load failures in the browser.
 *
 * ── Why this exists ──────────────────────────────────────────────────────────
 *
 * Every component client.js is loaded with a dynamic import().  A single
 * dropped request (flaky mobile network, CDN 5xx) rejects that import, the
 * component never mounts, and the reader keeps a page with dead widgets until
 * they reload.  Nothing retried.
 *
 * ── Why a plain retry of import() does not work ──────────────────────────────
 *
 * The browser records a failed module fetch in the document's module map, so
 * calling import() again for the same URL fails without a new request.  In
 * Chrome the retry never hits the network at all; in Safari it does for the
 * entry chunk but fails again when the same cached failure is hit by one of its
 * static dependencies.  Cache-busting the URL cannot help either, because the
 * chunk's own static imports keep their original URLs.
 *
 * ── What this does instead ───────────────────────────────────────────────────
 *
 * Vite routes every dynamic import through its __vitePreload helper and hands it
 * the full dependency list for that import (the chunk plus its static imports).
 * This plugin wraps that helper so, before the original helper runs, each JS
 * dependency is fetched with fetch(), retrying transient failures with
 * exponential backoff.  Vite leaves the list empty for a chunk with no
 * dependencies of its own (the common case for a component client.js whose
 * private modules were inlined), so the plugin also asks for the chunk itself
 * through build.modulePreload.resolveDependencies.
 *
 * fetch() leaves no entry in the module map, so a failed attempt costs nothing;
 * once a chunk has been fetched, the real import() is served from the HTTP
 * cache.  The first warm-up attempt uses cache: 'force-cache' so a chunk the page
 * already holds is not revalidated; retries use cache: 'reload' because the
 * browser may have cached the failed response.  An attempt that gets no response
 * headers within `timeout` is aborted, and retrying stops after `maxWait` in
 * total.  If every attempt fails the
 * original helper runs and fails as before.
 *
 * ── Cost ─────────────────────────────────────────────────────────────────────
 *
 * Chunks are content-hashed, so serve them with
 * `Cache-Control: public, max-age=31536000, immutable`.  Then the warm-up fetch
 * is the only network request and the import() that follows is a cache hit
 * (measured at 1-10 ms; on real sites pages, 1 request per chunk, identical
 * bytes).  Without it the browser falls back to heuristic freshness, which a CDN
 * `Age` header can already have used up, so import() revalidates a chunk the
 * warm-up just fetched: up to twice the requests, and up to one round trip of
 * added latency for those chunks (twice the bytes under `no-store`).  That final
 * import() request is not retried.  Hence this is opt-in.
 *
 * ── Limits ───────────────────────────────────────────────────────────────────
 *
 * Applies to every dynamic import in the bundle, not just component client.js.
 * Does NOT cover the entry bootstrap's own static import graph (loaded by the
 * HTML <script type="module"> and its modulepreload links): nothing runs to
 * retry a failure there.  Likewise a chunk that an HTML-level
 * <link rel="modulepreload"> (getComponentPreloads) fetched and failed is
 * already recorded as failed in the module map, so a retry cannot help it.
 * A user plugin that sets build.modulePreload.resolveDependencies after this one
 * replaces the single-file-chunk support.
 *
 * The wrapper is applied by a transform on Vite's virtual preload-helper module
 * and depends on its `export const __vitePreload =` declaration.  If a future
 * Vite changes that shape, the build warns and ships unwrapped, never broken.
 *
 * @param {object} [options]  see normalizeOptions()
 * @returns {object} Vite/Rollup plugin
 */
function viteChunkRetryPlugin(options) {
  const runtime = RETRY_RUNTIME.replace('__CLAY_RETRY_OPTIONS__', JSON.stringify(normalizeOptions(options)));

  let enabled = true;

  // With cssCodeSplit Vite drops pure-CSS chunks but still reports them to
  // resolveDependencies, so the chunk itself may not exist.  claycli builds
  // with cssCodeSplit:false, where every chunk file exists.
  let canAddChunk = true;


  return {
    name: 'clay-vite-chunk-retry',
    apply: 'build',

    // Vite only passes a dependency list to __vitePreload when the chunk has
    // more than one file.  Add the chunk itself when the list would be empty so
    // single-file chunks get the same retry.  Skipped when module preloading is
    // switched off, and composed with any resolveDependencies already set.
    config(userConfig) {
      const preload = userConfig && userConfig.build && userConfig.build.modulePreload;

      if (preload === false) {
        enabled = false;

        return null;
      }

      const existing = preload && typeof preload.resolveDependencies === 'function'
        ? preload.resolveDependencies : null;

      return {
        build: {
          modulePreload: {
            resolveDependencies(filename, deps, context) {
              const resolved = existing ? existing(filename, deps, context) : deps;
              const add = canAddChunk && context && context.hostType === 'js' && resolved.length === 0;

              return add ? [filename] : resolved;
            },
          },
        },
      };
    },

    configResolved(config) {
      canAddChunk = config.build.cssCodeSplit === false;
    },

    transform(code, id) {
      if (!enabled || id !== PRELOAD_HELPER_ID) return null;

      if (code.indexOf(PRELOAD_EXPORT) === -1) {
        this.warn('clay-vite-chunk-retry: unrecognised Vite preload helper; chunk-load retry is disabled for this build.');

        return null;
      }

      return {
        code: code.replace(PRELOAD_EXPORT, ORIGINAL_PRELOAD) + runtime,
        map: null,
      };
    },
  };
}

module.exports = viteChunkRetryPlugin;
module.exports.normalizeOptions = normalizeOptions;
module.exports.PRELOAD_HELPER_ID = PRELOAD_HELPER_ID;
module.exports.RETRY_RUNTIME = RETRY_RUNTIME;

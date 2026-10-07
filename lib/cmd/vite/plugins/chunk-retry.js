'use strict';

const PRELOAD_HELPER_ID = '\0vite/preload-helper.js';
const PRELOAD_EXPORT = 'export const __vitePreload =';
const ORIGINAL_PRELOAD = 'const __clayOriginalPreload =';

const DEFAULT_OPTIONS = { attempts: 3, delay: 300 };

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
var __clayCspBlocked = false;

// A CSP without this site's asset host in connect-src would make every warm-up
// fetch fail and add a pointless retry delay to every chunk.  The browser tells
// us when that happens, so stop warming and let import() load chunks as before.
if (typeof document !== 'undefined' && document.addEventListener) {
  document.addEventListener('securitypolicyviolation', function (e) {
    if (e.violatedDirective && e.violatedDirective.indexOf('connect-src') === 0) {
      __clayCspBlocked = true;
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

function __clayFetchChunk(url) {
  return fetch(url).then(function (res) {
    if (!res.ok) {
      var err = new Error('HTTP ' + res.status);

      err.transient = __clayIsTransient(res.status);
      throw err;
    }
    // Read the whole body so the response is complete (and cached) before
    // import() asks for the same URL.
    return res.arrayBuffer();
  });
}

// Resolves once the chunk is known to be fetchable, or once we give up.  Never
// rejects: after giving up the original preload runs, which fails exactly as it
// did before this wrapper existed.  Results are shared per URL so a chunk that
// many components depend on is retried once, not once per component.
function __clayWarmChunk(url) {
  if (__clayCspBlocked) return Promise.resolve();
  if (__clayWarmed[url]) return __clayWarmed[url];

  function attempt(n) {
    return __clayFetchChunk(url).then(function () {
      if (n > 1) console.debug('[clay vite] chunk loaded after ' + n + ' attempts: ' + url);
    }, function (err) {
      if ((err && err.transient === false) || n >= __clayRetry.attempts) {
        console.warn('[clay vite] chunk request failed (' + (err && err.message) + '): ' + url);
        return;
      }

      // The CSP violation event is queued as its own task, so it can arrive a
      // moment after this rejection.  Yield once before deciding to retry.
      return __claySleep(0).then(function () {
        if (__clayCspBlocked) return;

        return __claySleep(__clayRetry.delay * Math.pow(2, n - 1) * (1 + Math.random() * 0.5)).then(function () {
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
 * Return `value` when it is a finite number in [min, max], otherwise `fallback`.
 *
 * @param {*}      value
 * @param {number} min
 * @param {number} max
 * @param {number} fallback
 * @returns {number}
 */
function numberInRange(value, min, max, fallback) {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max ? value : fallback;
}

/**
 * Coerce user options to safe values; anything invalid falls back to defaults.
 *
 * @param {object} [options]
 * @param {number} [options.attempts]  total tries per chunk (1 disables retrying)
 * @param {number} [options.delay]     base backoff in ms, doubled per retry
 * @returns {{attempts: number, delay: number}}
 */
function normalizeOptions(options) {
  const opts = options && typeof options === 'object' ? options : {};
  const whole = Number.isInteger(opts.attempts) ? opts.attempts : NaN;

  return {
    attempts: numberInRange(whole, 1, 10, DEFAULT_OPTIONS.attempts),
    delay: numberInRange(opts.delay, 0, 10000, DEFAULT_OPTIONS.delay),
  };
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
 * through build.modulePreload.resolveDependencies.  fetch() leaves no entry in the module map, so a failed
 * attempt costs nothing; once a chunk has been fetched, the real import() is
 * served from the HTTP cache.  If every attempt fails the original helper runs
 * and fails as before, so a load that would have failed anyway only gets slower.
 *
 * ── Cost ─────────────────────────────────────────────────────────────────────
 *
 * Chunks are content-hashed, so serve them with
 * `Cache-Control: public, max-age=31536000, immutable`.  Then the warm-up fetch
 * is the only network request and the import() that follows is a cache hit
 * (measured at 1-10 ms).  Without a Cache-Control header the browser falls back
 * to heuristic freshness, which a CDN `Age` header can already have used up, so
 * it may revalidate the chunk a second time: one extra conditional request, and
 * up to one round trip of added latency for those chunks.  Pass
 * `chunkRetry: false` in bundlerConfig() to leave the wrapper out.
 *
 * Applies to every dynamic import in the bundle, not just component client.js.
 * Does NOT cover the entry bootstrap's own static import graph (loaded by the
 * HTML <script type="module"> and its modulepreload links): nothing runs to
 * retry a failure there.
 *
 * The wrapper is applied by a transform on Vite's virtual preload-helper module
 * and depends on its `export const __vitePreload =` declaration.  If a future
 * Vite changes that shape, the build warns and ships unwrapped, never broken.
 *
 * @param {object} [options]
 * @param {number} [options.attempts=3]  total tries per chunk
 * @param {number} [options.delay=300]   base backoff in ms
 * @returns {object} Vite/Rollup plugin
 */
function viteChunkRetryPlugin(options) {
  const runtime = RETRY_RUNTIME.replace('__CLAY_RETRY_OPTIONS__', JSON.stringify(normalizeOptions(options)));

  return {
    name: 'clay-vite-chunk-retry',
    apply: 'build',

    // Vite only passes a dependency list to __vitePreload when the chunk has
    // more than one file.  Add the chunk itself when the list would be empty so
    // single-file chunks get the same retry.  Skipped when module preloading is
    // switched off, and composed with any resolveDependencies already set.
    config(userConfig) {
      const preload = userConfig && userConfig.build && userConfig.build.modulePreload;

      if (preload === false) return null;

      const existing = preload && typeof preload.resolveDependencies === 'function'
        ? preload.resolveDependencies : null;

      return {
        build: {
          modulePreload: {
            resolveDependencies(filename, deps, context) {
              const resolved = existing ? existing(filename, deps, context) : deps;

              return context && context.hostType === 'js' && resolved.length === 0 ? [filename] : resolved;
            },
          },
        },
      };
    },

    transform(code, id) {
      if (id !== PRELOAD_HELPER_ID) return null;

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

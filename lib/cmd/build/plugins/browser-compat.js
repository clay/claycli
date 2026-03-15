'use strict';

/**
 * esbuild plugin that makes Clay CMS server-side code browser-safe.
 *
 * Clay components, services/universal/, and their transitive Node.js
 * dependencies frequently import packages that only work on the server
 * (clay-log, amphora-*, pg, ioredis, etc.).  When those modules are pulled
 * into a browser bundle they crash at initialization because they call
 * Node.js built-ins (fs, crypto, net, …) that don't exist in the browser.
 *
 * This plugin intercepts those imports at the esbuild resolve/load stage and
 * returns lightweight browser-safe stubs so the build succeeds and the
 * runtime never calls the problematic code.
 *
 * Mirrors the intent of what Browserify did automatically (it shimmed all
 * Node core modules via browserify-builtins) and what Webpack did via
 * `resolve.fallback` in webpack-node-externals plus the site's own
 * NormalModuleReplacementPlugin entries.
 * @returns {object} - esbuild plugin object
 */
function browserCompatPlugin() {
  return {
    name: 'clay-browser-compat',
    setup(build) {

      // ── Node.js built-in modules ─────────────────────────────────────────────
      // esbuild with platform:browser does not auto-stub these. Server-side
      // packages that slip into the browser bundle (via services/universal/ or
      // transitive deps) reference them at module level, which would throw.
      //
      // All stubs return an empty object. The richer stubs for events, stream,
      // util, and buffer follow below because many libraries extend or inherit
      // from them (EventEmitter, util.inherits, Buffer.isBuffer, etc.).
      //
      // 'http' and 'https' also get richer stubs (see below) because
      // agent-base patches https.request at import time.
      const simpleNodeBuiltins = new Set([
        'assert', 'child_process', 'cluster', 'crypto', 'dgram',
        'dns', 'domain', 'fs', 'module', 'net',
        'os', 'path', 'perf_hooks', 'punycode', 'querystring', 'readline',
        'repl', 'string_decoder', 'sys', 'timers', 'tls', 'tty',
        'url', 'v8', 'vm', 'worker_threads', 'zlib',
        // Optional native addon — never available in the browser
        'hiredis',
      ]);

      build.onResolve({ filter: /^[a-z_][a-z_0-9]*$/ }, args => {
        if (simpleNodeBuiltins.has(args.path)) {
          return { path: args.path, namespace: 'node-stub' };
        }
      });

      // Shared empty-module loader for all node-stub namespace entries.
      build.onLoad({ filter: /.*/, namespace: 'node-stub' }, () => ({
        contents: 'module.exports = {};',
        loader: 'js'
      }));

      // ── events ───────────────────────────────────────────────────────────────
      // Many Node.js libraries (http, net, stream, …) inherit from EventEmitter.
      // Stubbing 'events' as {} would break util.inherits and any class that
      // extends it, so we provide a real implementation.
      build.onResolve({ filter: /^events$/ }, () =>
        ({ path: 'events', namespace: 'node-stub-events' })
      );
      build.onLoad({ filter: /^events$/, namespace: 'node-stub-events' }, () => ({
        contents: `
          function EventEmitter() { this._events = this._events || {}; }
          EventEmitter.prototype.on = EventEmitter.prototype.addListener = function(type, fn) {
            if (!this._events[type]) this._events[type] = [];
            this._events[type].push(fn);
            return this;
          };
          EventEmitter.prototype.once = function(type, fn) {
            var self = this;
            function g() { self.removeListener(type, g); fn.apply(self, arguments); }
            g.listener = fn;
            return this.on(type, g);
          };
          EventEmitter.prototype.removeListener = EventEmitter.prototype.off = function(type, fn) {
            if (!this._events[type]) return this;
            this._events[type] = this._events[type].filter(function(l) { return l !== fn && l.listener !== fn; });
            return this;
          };
          EventEmitter.prototype.removeAllListeners = function(type) {
            if (type) delete this._events[type]; else this._events = {};
            return this;
          };
          EventEmitter.prototype.emit = function(type) {
            var ls = this._events[type];
            if (!ls || !ls.length) return false;
            var args = Array.prototype.slice.call(arguments, 1);
            ls.slice().forEach(function(fn) { fn.apply(null, args); });
            return true;
          };
          EventEmitter.prototype.listeners = function(type) { return (this._events[type] || []).slice(); };
          EventEmitter.prototype.listenerCount = function(type) { return (this._events[type] || []).length; };
          EventEmitter.EventEmitter = EventEmitter;
          module.exports = EventEmitter;
          module.exports.EventEmitter = EventEmitter;
        `,
        loader: 'js'
      }));

      // ── stream ───────────────────────────────────────────────────────────────
      // Extend our EventEmitter stub so that util.inherits(X, require('stream'))
      // and util.inherits(X, require('stream').Readable) work without crashing.
      build.onResolve({ filter: /^stream$/ }, () =>
        ({ path: 'stream', namespace: 'node-stub-stream' })
      );
      build.onLoad({ filter: /^stream$/, namespace: 'node-stub-stream' }, () => ({
        contents: `
          var EventEmitter = require('events');
          function Stream() { EventEmitter.call(this); }
          Stream.prototype = Object.create(EventEmitter.prototype, {
            constructor: { value: Stream, writable: true, configurable: true }
          });
          Stream.prototype.pipe = function() { return this; };
          function makePassthrough() {
            function S() { Stream.call(this); }
            S.prototype = Object.create(Stream.prototype, {
              constructor: { value: S, writable: true, configurable: true }
            });
            return S;
          }
          Stream.Readable = makePassthrough();
          Stream.Writable = makePassthrough();
          Stream.Transform = makePassthrough();
          Stream.Duplex = makePassthrough();
          Stream.PassThrough = makePassthrough();
          Stream.Stream = Stream;
          module.exports = Stream;
          module.exports.Stream = Stream;
          module.exports.Readable = Stream.Readable;
          module.exports.Writable = Stream.Writable;
          module.exports.Transform = Stream.Transform;
          module.exports.Duplex = Stream.Duplex;
          module.exports.PassThrough = Stream.PassThrough;
        `,
        loader: 'js'
      }));

      // ── util ─────────────────────────────────────────────────────────────────
      // util.inherits is used by many CommonJS libraries to set up prototype
      // chains. util.promisify, util.deprecate, and util.inspect are also
      // referenced at module level in some packages.
      build.onResolve({ filter: /^util$/ }, () =>
        ({ path: 'util', namespace: 'node-stub-util' })
      );
      build.onLoad({ filter: /^util$/, namespace: 'node-stub-util' }, () => ({
        contents: `
          var EventEmitter = require('events');
          exports.inherits = function inherits(ctor, superCtor) {
            if (!ctor || !superCtor || !superCtor.prototype) return;
            ctor.super_ = superCtor;
            ctor.prototype = Object.create(superCtor.prototype, {
              constructor: { value: ctor, writable: true, configurable: true }
            });
          };
          exports.promisify = function(fn) { return fn; };
          exports.deprecate = function(fn) { return fn; };
          exports.inspect = function(obj) {
            try { return JSON.stringify(obj); } catch(e) { return String(obj); }
          };
          exports.isString = function(v) { return typeof v === 'string'; };
          exports.isArray = Array.isArray;
          exports.isObject = function(v) { return v !== null && typeof v === 'object'; };
          exports.EventEmitter = EventEmitter;
        `,
        loader: 'js'
      }));

      // ── buffer ───────────────────────────────────────────────────────────────
      // Buffer.isBuffer / Buffer.from / Buffer.alloc are called at module level
      // in several npm packages. The browser has no global Buffer, so provide a
      // minimal shim. Real Buffer usage (e.g. binary encoding) is not supported.
      build.onResolve({ filter: /^buffer$/ }, () =>
        ({ path: 'buffer', namespace: 'node-stub-buffer' })
      );
      build.onLoad({ filter: /^buffer$/, namespace: 'node-stub-buffer' }, () => ({
        contents: `
          exports.Buffer = typeof Buffer !== 'undefined'
            ? Buffer
            : {
                isBuffer: function() { return false; },
                from: function() { return []; },
                alloc: function() { return []; }
              };
        `,
        loader: 'js'
      }));

      // ── http / https ─────────────────────────────────────────────────────────
      // agent-base (a transitive dep of ioredis / pg) patches https.request at
      // import time and reads https.request.__agent_base_https_request_patched__.
      // Stubbing http/https as {} causes it to crash accessing that property on
      // undefined. Provide a richer stub with a no-op request() and the flag
      // pre-set so the patch succeeds silently.
      const httpStubContents = `
        var EventEmitter = require('events');
        function noop() {}
        var noopReq = { on: function() { return this; }, end: noop, write: noop,
                        destroy: noop, setTimeout: noop, abort: noop };
        noopReq.on = function() { return noopReq; };
        function request() { return noopReq; }
        request.__agent_base_https_request_patched__ = true;
        module.exports = {
          request: request, get: request,
          createServer: function() { return { listen: noop, on: function() { return this; } }; },
          Agent: function Agent() {},
          IncomingMessage: function IncomingMessage() {},
          Server: function Server() {},
          ServerResponse: function ServerResponse() {},
          ClientRequest: function ClientRequest() {},
        };
      `;

      build.onResolve({ filter: /^https?$/ }, args =>
        ({ path: args.path, namespace: 'node-stub-http' })
      );
      build.onLoad({ filter: /.*/, namespace: 'node-stub-http' }, () => ({
        contents: httpStubContents,
        loader: 'js'
      }));
    }
  };
}

module.exports = browserCompatPlugin;

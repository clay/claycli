'use strict';

/**
 * Rollup plugin that makes Clay CMS server-side code browser-safe.
 *
 * Mirrors lib/cmd/build/plugins/browser-compat.js but uses Rollup's
 * resolveId / load hooks instead of esbuild's onResolve / onLoad hooks.
 *
 * @returns {object} - Rollup plugin object
 */
function browserCompatPlugin() {
  const NAMESPACE_SIMPLE = 'node-stub:simple';
  const NAMESPACE_EVENTS = 'node-stub:events';
  const NAMESPACE_STREAM = 'node-stub:stream';
  const NAMESPACE_UTIL   = 'node-stub:util';
  const NAMESPACE_BUFFER = 'node-stub:buffer';
  const NAMESPACE_HTTP   = 'node-stub:http';

  const simpleNodeBuiltins = new Set([
    'assert', 'child_process', 'cluster', 'crypto', 'dgram',
    'dns', 'domain', 'fs', 'module', 'net',
    'os', 'path', 'perf_hooks', 'punycode', 'querystring', 'readline',
    'repl', 'string_decoder', 'sys', 'timers', 'tls', 'tty',
    'url', 'v8', 'vm', 'worker_threads', 'zlib',
    'hiredis',
  ]);

  const EVENTS_STUB = `
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
  `;

  const STREAM_STUB = `
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
  `;

  const UTIL_STUB = `
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
  `;

  const BUFFER_STUB = `
    exports.Buffer = typeof Buffer !== 'undefined'
      ? Buffer
      : {
          isBuffer: function() { return false; },
          from: function() { return []; },
          alloc: function() { return []; }
        };
  `;

  const HTTP_STUB = `
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

  return {
    name: 'clay-browser-compat',

    resolveId(id) {
      if (simpleNodeBuiltins.has(id)) {
        return `\0${NAMESPACE_SIMPLE}:${id}`;
      }
      if (id === 'events') return `\0${NAMESPACE_EVENTS}`;
      if (id === 'stream') return `\0${NAMESPACE_STREAM}`;
      if (id === 'util')   return `\0${NAMESPACE_UTIL}`;
      if (id === 'buffer') return `\0${NAMESPACE_BUFFER}`;
      if (id === 'http' || id === 'https') return `\0${NAMESPACE_HTTP}:${id}`;
    },

    load(id) {
      if (id.startsWith(`\0${NAMESPACE_SIMPLE}:`)) {
        return 'module.exports = {};';
      }
      if (id === `\0${NAMESPACE_EVENTS}`) return EVENTS_STUB;
      if (id === `\0${NAMESPACE_STREAM}`) return STREAM_STUB;
      if (id === `\0${NAMESPACE_UTIL}`)   return UTIL_STUB;
      if (id === `\0${NAMESPACE_BUFFER}`) return BUFFER_STUB;
      if (id.startsWith(`\0${NAMESPACE_HTTP}:`)) return HTTP_STUB;
    },
  };
}

module.exports = browserCompatPlugin;

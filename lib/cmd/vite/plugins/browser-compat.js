'use strict';

/**
 * Vite/Rollup plugin that stubs Node.js built-in modules with browser-safe
 * ESM implementations.
 *
 * Uses the standard Rollup resolveId + load hook pair so it works in Vite's
 * build pipeline. Runs with enforce:'pre' so it fires before Vite's own
 * module resolver, ensuring built-ins are intercepted even when imported by
 * CJS packages that @rollup/plugin-commonjs is converting.
 */

const VIRTUAL_PREFIX = '\0clay-vite-compat:';

// Modules that can be safely replaced with an empty object namespace.
const SIMPLE_STUBS = new Set([
  'assert', 'child_process', 'cluster', 'crypto', 'dgram', 'dns', 'domain',
  'fs', 'module', 'net', 'os', 'path', 'perf_hooks', 'punycode', 'querystring',
  'readline', 'repl', 'string_decoder', 'sys', 'timers', 'tls', 'tty', 'url',
  'v8', 'vm', 'worker_threads', 'zlib', 'hiredis',
  // node: prefix variants
  'node:path', 'node:fs', 'node:os', 'node:crypto', 'node:url',
  'node:stream', 'node:events', 'node:util', 'node:buffer', 'node:http', 'node:https',
  'node:assert', 'node:child_process', 'node:cluster', 'node:dgram', 'node:dns',
  'node:domain', 'node:module', 'node:net', 'node:perf_hooks', 'node:punycode',
  'node:querystring', 'node:readline', 'node:repl', 'node:string_decoder', 'node:sys',
  'node:timers', 'node:tls', 'node:tty', 'node:v8', 'node:vm', 'node:worker_threads',
  'node:zlib',
]);

// Modules that need a richer stub because libraries extend/inherit from them.
const RICH_STUBS = new Set(['events', 'stream', 'util', 'buffer', 'http', 'https', 'node-fetch']);

const EVENTS_STUB = `
function EventEmitter() { this._events = this._events || {}; this._maxListeners = 10; }
EventEmitter.prototype.on = EventEmitter.prototype.addListener = function(type, fn) {
  if (!this._events[type]) this._events[type] = [];
  this._events[type].push(fn);
  return this;
};
EventEmitter.prototype.once = function(type, fn) {
  var self = this;
  function g() { self.removeListener(type, g); fn.apply(self, arguments); }
  g._fn = fn;
  return this.on(type, g);
};
EventEmitter.prototype.removeListener = EventEmitter.prototype.off = function(type, fn) {
  if (!this._events[type]) return this;
  this._events[type] = this._events[type].filter(function(l) { return l !== fn && l._fn !== fn; });
  return this;
};
EventEmitter.prototype.removeAllListeners = function(type) {
  if (type) { delete this._events[type]; } else { this._events = {}; }
  return this;
};
EventEmitter.prototype.emit = function(type) {
  var ls = this._events[type];
  if (!ls || !ls.length) return false;
  var args = Array.prototype.slice.call(arguments, 1);
  ls.slice().forEach(function(fn) { try { fn.apply(null, args); } catch(_) {} });
  return true;
};
EventEmitter.prototype.listeners = function(type) { return (this._events[type] || []).slice(); };
EventEmitter.prototype.listenerCount = function(type) { return (this._events[type] || []).length; };
EventEmitter.EventEmitter = EventEmitter;
export default EventEmitter;
export { EventEmitter };
`;

const STREAM_STUB = `
function EventEmitter() { this._events = {}; }
EventEmitter.prototype.on = function(t, fn) { (this._events[t] = this._events[t] || []).push(fn); return this; };
EventEmitter.prototype.once = function(t, fn) {
  var s = this; function g() { s.removeListener(t, g); fn.apply(s, arguments); } g._fn = fn; return this.on(t, g);
};
EventEmitter.prototype.removeListener = function(t, fn) {
  if (!this._events[t]) return this;
  this._events[t] = this._events[t].filter(function(l) { return l !== fn && l._fn !== fn; }); return this;
};
EventEmitter.prototype.emit = function(t) {
  var ls = this._events[t]; if (!ls) return false;
  var a = Array.prototype.slice.call(arguments, 1); ls.slice().forEach(function(fn) { try { fn.apply(null, a); } catch(_) {} }); return true;
};
function Stream() { EventEmitter.call(this); }
Stream.prototype = Object.create(EventEmitter.prototype, { constructor: { value: Stream, writable: true, configurable: true } });
Stream.prototype.pipe = function() { return this; };
function makeClass(name) {
  function C() { Stream.call(this); } C.displayName = name;
  C.prototype = Object.create(Stream.prototype, { constructor: { value: C, writable: true, configurable: true } });
  return C;
}
Stream.Readable = makeClass('Readable');
Stream.Writable = makeClass('Writable');
Stream.Transform = makeClass('Transform');
Stream.Duplex = makeClass('Duplex');
Stream.PassThrough = makeClass('PassThrough');
Stream.Stream = Stream;
export default Stream;
export var Readable = Stream.Readable;
export var Writable = Stream.Writable;
export var Transform = Stream.Transform;
export var Duplex = Stream.Duplex;
export var PassThrough = Stream.PassThrough;
`;

const UTIL_STUB = `
export function inherits(ctor, superCtor) {
  if (!ctor || !superCtor || !superCtor.prototype) return;
  ctor.super_ = superCtor;
  ctor.prototype = Object.create(superCtor.prototype, {
    constructor: { value: ctor, writable: true, configurable: true }
  });
}
export function promisify(fn) { return fn; }
export function deprecate(fn) { return fn; }
export function inspect(obj) { try { return JSON.stringify(obj); } catch(_) { return String(obj); } }
export var isString = function(v) { return typeof v === 'string'; };
export var isArray = Array.isArray;
export var isObject = function(v) { return v !== null && typeof v === 'object'; };
export var isFunction = function(v) { return typeof v === 'function'; };
var _util = { inherits, promisify, deprecate, inspect, isString, isArray, isObject, isFunction };
export default _util;
`;

const BUFFER_STUB = `
var _Buffer = typeof globalThis !== 'undefined' && globalThis.Buffer
  ? globalThis.Buffer
  : {
      isBuffer: function() { return false; },
      from: function(data) { return typeof data === 'string' ? { toString: function() { return data; }, length: data.length } : []; },
      alloc: function(size) { return new Uint8Array(size); },
      concat: function(list) { return list.reduce(function(a, b) { return Array.from(a).concat(Array.from(b)); }, []); },
    };
export var Buffer = _Buffer;
export default { Buffer: _Buffer };
`;

// node-fetch v1/v2 have no browser field; stub to native fetch so server-only
// dependencies (encoding → iconv-lite → safer-buffer) never enter the browser bundle.
const NODE_FETCH_STUB = `
export default function fetch(url, opts) { return globalThis.fetch(url, opts); }
`;

const HTTP_STUB = `
function noop() {}
var noopReq = { on: function() { return noopReq; }, end: noop, write: noop, destroy: noop, setTimeout: noop, abort: noop };
var _makeReq = function() { return noopReq; };
_makeReq.__agent_base_https_request_patched__ = true;
var _http = {
  request: _makeReq, get: _makeReq,
  createServer: function() { return { listen: noop, on: function() { return this; }, close: noop }; },
  Agent: function Agent() {},
  IncomingMessage: function IncomingMessage() {},
  Server: function Server() {},
  ServerResponse: function ServerResponse() {},
  ClientRequest: function ClientRequest() {},
};
export default _http;
export var request = _http.request;
export var get = _http.get;
export var createServer = _http.createServer;
export var Agent = _http.Agent;
`;

function viteBrowserCompatPlugin() {
  return {
    name: 'clay-vite-browser-compat',
    enforce: 'pre',

    resolveId(id) {
      // Strip node: prefix for lookup
      const bare = id.startsWith('node:') ? id.slice(5) : id;

      if (SIMPLE_STUBS.has(id) || SIMPLE_STUBS.has(bare)) {
        return `${VIRTUAL_PREFIX}simple:${id}`;
      }
      if (RICH_STUBS.has(id) || RICH_STUBS.has(bare)) {
        return `${VIRTUAL_PREFIX}rich:${bare}`;
      }

      return null;
    },

    load(id) {
      if (!id.startsWith(VIRTUAL_PREFIX)) return null;

      if (id.startsWith(`${VIRTUAL_PREFIX}simple:`)) {
        return 'export default {}; export {};';
      }

      const mod = id.slice(`${VIRTUAL_PREFIX}rich:`.length);

      switch (mod) {
        case 'events': return EVENTS_STUB;
        case 'stream': return STREAM_STUB;
        case 'util':   return UTIL_STUB;
        case 'buffer': return BUFFER_STUB;
        case 'http':       return HTTP_STUB;
        case 'https':      return HTTP_STUB;
        case 'node-fetch': return NODE_FETCH_STUB;
        default:           return 'export default {}; export {};';
      }
    },
  };
}

module.exports = viteBrowserCompatPlugin;

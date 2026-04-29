'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Vite plugin that stubs Node.js built-in modules with browser-safe ESM shims.
 *
 * ── Why this exists ──────────────────────────────────────────────────────────
 *
 * Clay components and services share code between the server (Node.js) and the
 * browser.  Many npm packages transitively depend on Node built-ins (fs, path,
 * events, stream, etc.) that do not exist in the browser.  Without stubs, Vite
 * would error on these imports and the bundle would fail to build.
 *
 * The legacy Browserify pipeline used browserify-built-ins (a package that
 * automatically polyfills Node core modules for browser bundles).  This plugin
 * replicates that behavior but with minimal, purpose-built stubs rather than
 * full polyfills — the browser code paths guarded by `isNode` checks never
 * actually call these APIs, so correctness matters less than not crashing.
 *
 * ── Simple vs rich stubs ─────────────────────────────────────────────────────
 *
 * Most built-ins are imported but never called in browser code paths; an empty
 * object is sufficient.  A handful of built-ins (events, stream, util, buffer,
 * http, https) are subclassed or extended by npm packages — those need a richer
 * stub that provides the correct prototype chain so inheritance works.
 *
 * ── node: prefix ────────────────────────────────────────────────────────────
 *
 * Node 14.18+ supports `import 'node:fs'` syntax.  Both the bare name and the
 * prefixed variant are handled here.
 *
 * ── Site-specific stubs ──────────────────────────────────────────────────────
 *
 * If a Clay instance imports a Node-only npm package that is not in the built-in
 * stub lists, add it via bundlerConfig() in claycli.config.js:
 *
 *   bundlerConfig: config => {
 *     config.browserStubs = {
 *       // null  → simple empty stub: export default {}; export {};
 *       'ioredis': null,
 *
 *       // string → custom ESM source emitted verbatim for that module
 *       'mongodb': 'export default { connect: function() { return Promise.resolve(); } };',
 *     };
 *   }
 *
 * The site's stubs are merged with the built-in stubs.  If a site provides a
 * stub for a module that is already in the built-in list, the site's version
 * takes precedence — useful when the generic empty stub is insufficient.
 *
 * Uses enforce:'pre' so this plugin's resolveId fires before Vite's own
 * resolver, ensuring built-ins are intercepted even when required by CJS
 * packages that @rollup/plugin-commonjs is converting.
 *
 * ── Lenient externalize mode ────────────────────────────────────────────────
 *
 * Vite wraps every unresolved-Node-builtin import in a Proxy that throws on
 * any property access ("Module \"\" has been externalized for browser
 * compatibility..."). The legacy Browserify pipeline — and raw Rollup before
 * Vite was introduced — were lenient: unresolved imports became `undefined`
 * or empty objects and evaluation silently continued. Code paths gated by
 * `if (process.browser)` never reached the broken value, so nothing threw at
 * runtime even if a Node-only package was statically bundled.
 *
 * Set `config.lenientBrowserExternalize = true` in claycli.config.js to opt
 * into the legacy behaviour: this plugin will intercept Vite's internal
 * `__vite-browser-external` virtual module and replace its throwing proxy
 * with an empty ESM module. Property reads return `undefined` and, like
 * Browserify, the runtime doesn't throw.
 *
 * Treat this as a migration flag, not a target state. It lets you ship a
 * working bundle while tracking down the real offender, rather than
 * blocking the whole build on one transitive Node-only import.
 *
 * ── package.json "browser" field `false` mappings ───────────────────────────
 *
 * npm packages frequently declare in their package.json:
 *
 *   "browser": {
 *     "./lib/terminal-highlight": false,
 *     "fs": false,
 *     "./jsonp-node.js": false
 *   }
 *
 * The convention — established by Browserify — is that a `false` value tells
 * the bundler to replace that import with an empty module when building for
 * the browser. Browserify honours this directly via `browser-resolve`; Vite's
 * resolver supports only *string* rewrites in the browser field and leaves
 * `false` entries to fall through to its default externalize-for-browser
 * behavior. That produces the confusing runtime error
 *
 *   `Module "" has been externalized for browser compatibility. Cannot access
 *    ".__esModule" in client code.`
 *
 * because the externalized proxy is created without a module name.
 *
 * This plugin fills that gap: when an import (bare specifier or relative
 * path) matches a `false` entry in the importer's enclosing package.json
 * `browser` field, we redirect it to an empty ESM stub — matching Browserify's
 * behavior exactly. Results are cached per package.json file so the walk is
 * paid only once per package.
 *
 * @param {object} [customStubs={}]  map of { moduleName: esmString | null }
 *   from bundlerConfig().browserStubs
 * @param {object} [options={}]
 * @param {boolean} [options.lenientExternalize=false]  when true, replace
 *   Vite's throwing `__vite-browser-external` proxy with an empty ESM module
 *   so unresolved Node-only imports behave like Browserify (silent undefined)
 *   instead of throwing on first property access.
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

// Vite's internal virtual id for the browser-externalization proxy. Both the
// bare form and the `:<moduleName>` suffixed form are produced by Vite at
// different call sites (the suffix carries the originally-requested module
// name for the throw message; bare is used for anonymous externals).
const VITE_BROWSER_EXTERNAL = '__vite-browser-external';

const EMPTY_MODULE = 'export default {}; export {};';

function loadRichStub(mod) {
  switch (mod) {
    case 'events': return EVENTS_STUB;
    case 'stream': return STREAM_STUB;
    case 'util':   return UTIL_STUB;
    case 'buffer': return BUFFER_STUB;
    case 'http':
    case 'https':      return HTTP_STUB;
    case 'node-fetch': return NODE_FETCH_STUB;
    default:           return EMPTY_MODULE;
  }
}

// Short-circuit Vite's `__vite-browser-external` virtual when lenient mode
// is on so the throwing proxy never loads. Returns the empty-module source
// on a hit, or null to let the normal load pipeline continue.
function isLenientExternalLoad(id, lenientExternalize) {
  if (!lenientExternalize) return null;
  if (id === VITE_BROWSER_EXTERNAL || id.startsWith(`${VITE_BROWSER_EXTERNAL}:`)) return EMPTY_MODULE;
  return null;
}

// Resolve a VIRTUAL_PREFIX-prefixed id (custom/simple/rich) into its ESM source.
function loadVirtualStub(id, resolveCustomStub) {
  if (id.startsWith(`${VIRTUAL_PREFIX}custom:`)) {
    const mod = id.slice(`${VIRTUAL_PREFIX}custom:`.length);
    const src = resolveCustomStub(mod);

    // null means the site wants the same empty-object treatment as a simple stub.
    return src === null || src === undefined ? EMPTY_MODULE : src;
  }

  if (id.startsWith(`${VIRTUAL_PREFIX}simple:`)) return EMPTY_MODULE;

  return loadRichStub(id.slice(`${VIRTUAL_PREFIX}rich:`.length));
}

function viteBrowserCompatPlugin(customStubs = {}, options = {}) {
  const lenientExternalize = options && options.lenientExternalize === true;
  // Build a lookup map for site-specific stubs: { moduleName → esmString | null }
  // null means "use a simple empty stub"; a string is emitted verbatim as ESM source.
  // Site stubs take precedence over built-ins when the same name appears in both.
  const customStubMap = customStubs && typeof customStubs === 'object' ? customStubs : {};

  function resolveCustomStub(id) {
    const bare = id.startsWith('node:') ? id.slice(5) : id;

    if (Object.prototype.hasOwnProperty.call(customStubMap, id)) return customStubMap[id];
    if (Object.prototype.hasOwnProperty.call(customStubMap, bare)) return customStubMap[bare];
    return undefined;
  }

  // ── Browser field "false" mapping resolver ─────────────────────────────────
  //
  // Caches the parsed browser-field map per package.json so the filesystem walk
  // is paid only once per package. Value shape:
  //
  //   {
  //     pkgDir: string,               // the directory containing package.json
  //     fieldMap: Object|null,        // { './lib/x': false, 'fs': false, ... }
  //   }
  //
  // A null fieldMap marks packages that have no object-form browser field
  // (plain-string browser fields are handled by Vite's resolver already).
  const packageCache = new Map();
  // Fast negative cache for directories that have no package.json ancestor.
  const noPkgDirs = new Set();

  // Read + parse a package.json and extract its object-form browser field.
  // Plain-string browser fields are handled by Vite's resolver already.
  function readBrowserEntry(dir, pkgPath) {
    const entry = { pkgDir: dir, fieldMap: null };

    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      const b = pkg.browser;

      if (b && typeof b === 'object' && !Array.isArray(b)) entry.fieldMap = b;
    } catch (_) {
      // malformed package.json — treat as having no browser field
    }

    return entry;
  }

  /**
   * Walk up from `fromDir` to the filesystem root looking for the nearest
   * package.json and return its parsed browser-field mappings.
   *
   * @param {string} fromDir
   * @returns {object} entry with { pkgDir, fieldMap } or null when not found
   */
  function findPackageBrowserField(fromDir) {
    let dir = fromDir;

    while (dir && dir !== path.dirname(dir)) {
      if (packageCache.has(dir)) return packageCache.get(dir);

      if (!noPkgDirs.has(dir)) {
        const pkgPath = path.join(dir, 'package.json');

        if (fs.existsSync(pkgPath)) {
          const entry = readBrowserEntry(dir, pkgPath);

          packageCache.set(dir, entry);
          return entry;
        }

        noPkgDirs.add(dir);
      }

      dir = path.dirname(dir);
    }

    return null;
  }

  // Does the resolved relative-to-pkg path of `id` match a `./foo: false`
  // entry in the browser field? Extracted so isBrowserFieldFalseMapping
  // stays under the complexity budget.
  function matchesRelativeFalseEntry(id, importer, entry) {
    if (!id.startsWith('.')) return false;

    const abs = path.resolve(path.dirname(importer), id);
    const relNoExt = `./${path.relative(entry.pkgDir, abs).replace(/\\/g, '/')}`.replace(/\.js$/, '');

    for (const key of Object.keys(entry.fieldMap)) {
      if (entry.fieldMap[key] !== false || !key.startsWith('./')) continue;
      if (key.replace(/\.js$/, '') === relNoExt) return true;
    }

    return false;
  }

  /**
   * Check whether `id` (as imported from `importer`) maps to `false` in the
   * importer's enclosing package.json browser field. Returns true only for
   * `false` entries; string entries are left to Vite's native resolver.
   *
   * Matches two shapes:
   *   1. The raw import string itself, e.g. `"fs": false` or
   *      `"./lib/terminal-highlight": false`.
   *   2. The resolved absolute path expressed relative to the package root,
   *      e.g. `"./lib/terminal-highlight"` when importer is
   *      `<pkg>/lib/css-syntax-error.js` and `id` is `"./terminal-highlight"`.
   *
   * @param {string} id
   * @param {string} importer
   * @returns {boolean}
   */
  function isBrowserFieldFalseMapping(id, importer) {
    if (!importer) return false;

    const entry = findPackageBrowserField(path.dirname(importer));

    if (!entry || !entry.fieldMap) return false;

    const map = entry.fieldMap;

    if (Object.prototype.hasOwnProperty.call(map, id) && map[id] === false) return true;

    return matchesRelativeFalseEntry(id, importer, entry);
  }

  return {
    name: 'clay-vite-browser-compat',
    enforce: 'pre',

    resolveId(id, importer) {
      // Strip node: prefix for lookup
      const bare = id.startsWith('node:') ? id.slice(5) : id;

      // Site-specific stubs are checked first so they can override built-ins.
      if (resolveCustomStub(id) !== undefined) {
        return `${VIRTUAL_PREFIX}custom:${id}`;
      }

      if (SIMPLE_STUBS.has(id) || SIMPLE_STUBS.has(bare)) {
        return `${VIRTUAL_PREFIX}simple:${id}`;
      }
      if (RICH_STUBS.has(id) || RICH_STUBS.has(bare)) {
        return `${VIRTUAL_PREFIX}rich:${bare}`;
      }

      // package.json "browser" field `false` mappings: replace with an empty
      // stub to match Browserify's `browser-resolve` behaviour. This catches
      // cases like postcss's `./lib/terminal-highlight: false` that Vite's
      // built-in resolver otherwise drops onto its `__vite-browser-external`
      // proxy (producing the empty-named `Module ""` runtime error).
      if (isBrowserFieldFalseMapping(id, importer)) {
        return `${VIRTUAL_PREFIX}simple:${id}`;
      }

      return null;
    },

    load(id) {
      const lenient = isLenientExternalLoad(id, lenientExternalize);

      if (lenient !== null) return lenient;

      if (!id.startsWith(VIRTUAL_PREFIX)) return null;

      return loadVirtualStub(id, resolveCustomStub);
    },
  };
}

module.exports = viteBrowserCompatPlugin;

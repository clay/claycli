'use strict';

const fs = require('fs');
const path = require('path');
const acorn = require('acorn');

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
 * string_decoder, http, https, url) are subclassed, instantiated, or extended by
 * npm packages — those need a richer stub that provides the correct prototype
 * chain (and any constructors consumers instantiate) so nothing throws.
 *
 * ── Stub import-safety invariant ─────────────────────────────────────────────
 *
 * Every stub MUST evaluate without throwing when imported. A stub is dead code
 * at runtime (guarded by isNode/process.browser), but its module body still runs
 * at bundle-eval time. Two rules keep that safe:
 *
 *   1. Constructor-like built-ins (buffer, events, stream classes, http.Agent)
 *      are exposed as FUNCTIONS with a real `.prototype`, never plain objects.
 *      Libraries subclass them (`X.prototype = Object.create(Buffer.prototype)`)
 *      and feature-detect methods at module-eval; a plain-object stub throws
 *      "Object prototype may only be an Object or null: undefined" and takes the
 *      whole bundle down before Kiln boots (the safe-buffer crash fixed in #253).
 *
 *   2. Prefer the browser's own global over a hand-written shim. A real
 *      `globalThis.Buffer` / `fetch` / `URL` is correct AND costs zero bundle
 *      bytes; fall back to a minimal function-shaped shim only when the page
 *      provides no global. preferGlobal() is the single source of truth for this
 *      pattern (buffer, node-fetch, url).
 *
 * Rule 1 is the safe-buffer/#253 crash: an incomplete stub shape throws at eval
 * and takes the whole bundle down before Kiln boots. When adding or changing a
 * stub, validate that it imports cleanly against the libraries that actually
 * reach it (e.g. crypto-browserify's create-hash → safe-buffer chain), not just
 * that the specifier resolves.
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
//
// Bare specifiers only. `node:`-prefixed ids (node:fs, node:buffer, …) are
// normalized to their bare name in resolveId() and routed here or to RICH_STUBS,
// so the prefixed variants don't need listing. Critically, a rich built-in's
// node: form must NOT appear here: listing e.g. `node:buffer` would short-circuit
// it to an empty stub and re-introduce the subclass-at-eval crash (see the
// import-safety invariant above) that the rich buffer stub exists to prevent.
const SIMPLE_STUBS = new Set([
  'assert', 'child_process', 'cluster', 'crypto', 'dgram', 'dns', 'domain',
  'fs', 'module', 'net', 'os', 'path', 'perf_hooks', 'punycode', 'querystring',
  'readline', 'repl', 'sys', 'timers', 'tls', 'tty',
  'v8', 'vm', 'worker_threads', 'zlib', 'hiredis',
]);

// Modules that need a richer stub because libraries extend/inherit from them.
const RICH_STUBS = new Set(['events', 'stream', 'util', 'buffer', 'string_decoder', 'http', 'https', 'node-fetch', 'url']);

/**
 * Build a "prefer the browser's real global, else fall back" expression for use
 * inside a stub's ESM source. Centralizes rule 2 of the import-safety invariant
 * (prefer a real, zero-cost browser global) so every constructor-like stub
 * applies it identically instead of hand-rolling the globalThis check.
 *
 * @param {string} globalName - the global to prefer, e.g. 'Buffer', 'URL'
 * @param {string} fallbackExpr - JS expression used when the global is absent
 * @returns {string} an expression string such as
 *   "(typeof globalThis !== 'undefined' && globalThis.URL) ? globalThis.URL : (function URL() {})"
 */
function preferGlobal(globalName, fallbackExpr) {
  return `(typeof globalThis !== 'undefined' && globalThis.${globalName}) ? globalThis.${globalName} : (${fallbackExpr})`;
}

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

// Browser stub for Node's `buffer`.
//
// Real Buffer work only happens server-side; the browser code paths that reach
// these APIs are guarded by isNode()/process.browser and never actually run.
// Two non-obvious constraints shape this stub — both learned from real crashes
// in the kiln-edit bundle:
//
//   1. `Buffer` must be a FUNCTION with a real `.prototype`, never a plain
//      object. Libraries such as safe-buffer subclass it via
//      `SafeBuffer.prototype = Object.create(Buffer.prototype)`. A plain-object
//      Buffer has an `undefined` prototype, so that line throws
//      "Object prototype may only be an Object or null: undefined" at module
//      evaluation — taking down the whole kiln-edit bundle before Kiln boots.
//
//   2. It must expose from/alloc/allocUnsafe/allocUnsafeSlow. safe-buffer
//      feature-detects all four; when they are present it simply re-exports this
//      stub (`module.exports = buffer`) and never reaches the Object.create
//      subclassing branch above. Omitting any one sends it down that branch.
//
// A real global Buffer polyfill (globalThis.Buffer) is preferred when the page
// provides one; otherwise we fall back to the function-shaped stub below.
const BUFFER_STUB = `
function _clayBuffer(arg, encodingOrOffset, length) {
  return _clayBuffer.from(arg, encodingOrOffset, length);
}
_clayBuffer.isBuffer = function() { return false; };
_clayBuffer.from = function(data) {
  return typeof data === 'string'
    ? { toString: function() { return data; }, length: data.length }
    : (data && typeof data.length === 'number' ? Array.prototype.slice.call(data) : []);
};
_clayBuffer.alloc = function(size) { return new Uint8Array(size > 0 ? size : 0); };
_clayBuffer.allocUnsafe = function(size) { return new Uint8Array(size > 0 ? size : 0); };
_clayBuffer.allocUnsafeSlow = function(size) { return new Uint8Array(size > 0 ? size : 0); };
_clayBuffer.concat = function(list) { return (list || []).reduce(function(a, b) { return Array.from(a).concat(Array.from(b)); }, []); };
var _Buffer = ${preferGlobal('Buffer', '_clayBuffer')};
export var Buffer = _Buffer;
export function SlowBuffer(size) { return _Buffer.alloc(size > 0 ? size : 0); }
export default { Buffer: _Buffer, SlowBuffer: SlowBuffer };
`;

// Browser stub for Node's `url`.
//
// The browser ships the real WHATWG URL/URLSearchParams — prefer them (rule 2:
// correct and zero bundle cost). The fallbacks are function-shaped (rule 1) so
// importing `url` and subclassing/feature-detecting these never throws when no
// global exists (e.g. a non-DOM worker). Legacy url.parse()/format() are
// intentionally omitted — they were absent from the previous empty stub too, so
// this change is purely additive (it only adds the two WHATWG constructors).
const URL_STUB = `
var _URL = ${preferGlobal('URL', 'function URL() {}')};
var _URLSearchParams = ${preferGlobal('URLSearchParams', 'function URLSearchParams() {}')};
export var URL = _URL;
export var URLSearchParams = _URLSearchParams;
export default { URL: _URL, URLSearchParams: _URLSearchParams };
`;

// Browser stub for Node's `string_decoder`.
//
// `string_decoder` is both a Node builtin AND a userland npm package, so browser-
// compat intercepts the bare specifier — which means an empty stub silently
// breaks any code that constructs a StringDecoder. cipher-base (the base class
// behind crypto-browserify's create-hash / createHmac) does
// `new StringDecoder(enc).write(buf)` inside `.digest('hex' | 'base64' | …)`; an
// empty stub throws "StringDecoder is not a constructor" the instant a hash or
// HMAC is stringified in the browser.
//
// This minimal StringDecoder delegates to the Buffer's own toString(encoding), so
// with a real global Buffer (rule 2) a one-shot `.digest(enc)` returns the right
// string. The full decoder's multi-byte streaming boundary handling is
// unnecessary here — digests write the whole buffer in a single call.
const STRING_DECODER_STUB = `
export function StringDecoder(encoding) { this.encoding = encoding || 'utf8'; }
StringDecoder.prototype.write = function(buf) {
  if (buf == null) return '';
  return typeof buf.toString === 'function' ? buf.toString(this.encoding) : String(buf);
};
StringDecoder.prototype.end = function(buf) { return buf == null ? '' : this.write(buf); };
export default { StringDecoder: StringDecoder };
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

// Map of rich built-in name → ESM stub source. A lookup table (rather than a
// switch) keeps loadRichStub flat as the set of rich stubs grows. Every name here
// must also be in RICH_STUBS so resolveId routes it to the rich branch.
const RICH_STUB_SOURCES = {
  events: EVENTS_STUB,
  stream: STREAM_STUB,
  util: UTIL_STUB,
  buffer: BUFFER_STUB,
  url: URL_STUB,
  string_decoder: STRING_DECODER_STUB,
  http: HTTP_STUB,
  https: HTTP_STUB,
  'node-fetch': NODE_FETCH_STUB,
};

/**
 * Resolve a rich built-in's ESM stub source by bare module name.
 *
 * @param {string} mod - the bare module name (e.g. 'buffer', 'string_decoder')
 * @returns {string} the ESM stub source, or the empty module for unknown names
 */
function loadRichStub(mod) {
  return Object.prototype.hasOwnProperty.call(RICH_STUB_SOURCES, mod)
    ? RICH_STUB_SOURCES[mod]
    : EMPTY_MODULE;
}

// ── Stub member-shape introspection ─────────────────────────────────────────
//
// Every stub above only ever throws for one reason in practice: real code
// calls a property the stub's ESM source never defines (querystring.stringify,
// url.format — see CLAY-VITE.md § Stub member gaps). extractStubMemberNames()
// statically determines exactly which top-level property names a stub's
// source makes available, so a Vite plugin (scanStubMemberGaps in scripts.js)
// can flag a call site referencing anything outside that set before it ever
// reaches a browser.
//
// Parses with acorn rather than eval — this runs against site-authored custom
// stubs too (bundlerConfig().browserStubs), and those are arbitrary strings
// from claycli.config.js that must never be executed by the build.
//
// What "member names" means here: `require(mod)` resolves to the stub's
// *default* export directly (requireReturnsDefault: 'preferred' in
// baseViteConfig()'s commonjsOptions — see buildPlugins() doc block), so a
// call site's `mod.thing` reaches either a named export (for `import {thing}
// from mod`) or a key of the default export's value (for CJS-style `require`).
// This function returns the union of both surfaces since call sites in this
// codebase use both import styles.

// A Property node's key name, whether written as an identifier (`{ foo: 1 }`)
// or a string literal (`{ 'foo': 1 }`); null for anything else (a computed
// key is filtered by the caller before this is reached).
function propertyKeyName(prop) {
  if (prop.key.type === 'Identifier') return prop.key.name;
  if (prop.key.type === 'Literal') return String(prop.key.value);
  return null;
}

/**
 * Collect the top-level, non-computed string/identifier keys of an
 * ObjectExpression AST node into `into`. No-ops for any other node type
 * (e.g. a default export that's a bare function, like node-fetch's — nothing
 * to collect, and nothing callers should flag member access on since
 * function-shaped defaults are invoked directly, not via `.member`).
 *
 * @param {object} node - an acorn AST node
 * @param {Set<string>} into
 * @returns {void}
 */
function collectObjectExpressionKeys(node, into) {
  if (!node || node.type !== 'ObjectExpression') return;

  for (const prop of node.properties) {
    if (prop.type !== 'Property' || prop.computed) continue;

    const key = propertyKeyName(prop);

    if (key) into.add(key);
  }
}

// `export default X;` referencing a variable (`export default _http;`) needs
// that variable's own shape resolved — this collects, for every top-level
// `var NAME = { ... }` and `function NAME() {}` in `ast.body`, the member
// names NAME exposes, so collectDefaultExportNames() can look one up
// regardless of source order.
//
// A function is seeded with an empty set rather than skipped: stubs commonly
// attach static properties to a declared function after the fact — e.g.
// STREAM_STUB does `function Stream() {...}` then `Stream.Readable = ...`,
// `Stream.Stream = Stream`, and finally `export default Stream`. Those
// assignments are collected in a second pass below, once every trackable name
// (object-literal or function) is known — order doesn't matter between the
// two passes since assignments can appear before or after the function/object
// they extend.
//
// `var NAME = { ... }` declarators' own keys, for every declarator in one
// VariableDeclaration statement.
function collectObjectLiteralDeclarators(node, literals) {
  for (const decl of node.declarations) {
    if (decl.id.type !== 'Identifier' || !decl.init || decl.init.type !== 'ObjectExpression') continue;

    const keys = new Set();

    collectObjectExpressionKeys(decl.init, keys);
    literals.set(decl.id.name, keys);
  }
}

// One top-level statement's contribution to the declared-name -> members map:
// a `var NAME = { ... }` declarator's own keys, or a bare seed for
// `function NAME() {}` (static properties are added by a later pass).
function collectDeclaredNameFromStatement(node, literals) {
  if (node.type === 'VariableDeclaration') {
    collectObjectLiteralDeclarators(node, literals);
  } else if (node.type === 'FunctionDeclaration' && node.id && !literals.has(node.id.name)) {
    literals.set(node.id.name, new Set());
  }
}

// Is `target` a non-computed `Name.member` shape (an Identifier object, an
// Identifier property)? Excludes a nested target like `Name.prototype.pipe`,
// whose object is itself a MemberExpression rather than a plain Identifier.
function isNamedMemberTarget(target) {
  return target.type === 'MemberExpression' && !target.computed &&
    target.object.type === 'Identifier' && target.property.type === 'Identifier';
}

// The assignment target of a top-level `Name.member = ...;` expression
// statement, or null for anything else.
function staticAssignmentTarget(node) {
  if (node.type !== 'ExpressionStatement') return null;

  const expr = node.expression;

  if (!expr || expr.type !== 'AssignmentExpression' || expr.operator !== '=') return null;

  return isNamedMemberTarget(expr.left) ? expr.left : null;
}

// `Name.member = ...;` — a static property assigned onto any name `literals`
// is already tracking (see staticAssignmentTarget() for exactly which shape
// qualifies; e.g. `Stream.prototype.pipe = ...` is correctly not attributed
// to `Stream` itself).
function addStaticPropertyAssignment(node, literals) {
  const target = staticAssignmentTarget(node);

  if (!target || !literals.has(target.object.name)) return;

  literals.get(target.object.name).add(target.property.name);
}

// @param {object} ast - acorn Program node
// @returns {Map<string, Set<string>>} declared name -> its known member names
function collectTopLevelObjectLiterals(ast) {
  const literals = new Map();

  ast.body.forEach(node => collectDeclaredNameFromStatement(node, literals));
  // Second pass so assignment order doesn't matter relative to the
  // function/object declaration it extends — see addStaticPropertyAssignment().
  ast.body.forEach(node => addStaticPropertyAssignment(node, literals));

  return literals;
}

// `export var/function/const NAME` and `export { NAME, other as alias };` —
// every named-export name an ExportNamedDeclaration node introduces.
function collectNamedExportNames(node, into) {
  if (node.declaration) {
    if (node.declaration.type === 'VariableDeclaration') {
      for (const decl of node.declaration.declarations) {
        if (decl.id.type === 'Identifier') into.add(decl.id.name);
      }
    } else if (node.declaration.id) {
      // export function NAME() {} / export class NAME {}
      into.add(node.declaration.id.name);
    }
  }

  for (const spec of node.specifiers || []) {
    into.add(spec.exported.name);
  }
}

// `export default { ... }` (inline) or `export default NAME;` (referencing a
// top-level object-literal variable, e.g. HTTP_STUB's `export default _http;`)
// — the member names it contributes. A default export that's a function/
// class/other expression contributes none (see collectObjectExpressionKeys()'s
// doc block).
function collectDefaultExportNames(node, topLevelObjectLiterals, into) {
  const decl = node.declaration;

  if (decl.type === 'ObjectExpression') {
    collectObjectExpressionKeys(decl, into);
  } else if (decl.type === 'Identifier' && topLevelObjectLiterals.has(decl.name)) {
    for (const key of topLevelObjectLiterals.get(decl.name)) into.add(key);
  }
}

/**
 * Statically extract the set of member names a stub's ESM source exposes on
 * the value that `require(mod)`/`import mod from mod` resolves to. See the
 * doc block above this section for what "member names" means and why.
 *
 * Only inspects `source`'s top-level statements — every stub in this file
 * (and every realistic custom stub) declares its exports at module top
 * level, so a full recursive walk isn't needed here (contrast with
 * scanStubMemberGaps() in scripts.js, which does need one — it's looking for
 * member access anywhere in arbitrary first-party source, not just exports
 * in a stub we authored).
 *
 * @param {string} source - ESM stub source (built-in or a site's custom stub)
 * @returns {Set<string>} member names accessible off the resolved module value
 */
function extractStubMemberNames(source) {
  const names = new Set();

  let ast;

  try {
    ast = acorn.parse(source, { ecmaVersion: 2022, sourceType: 'module' });
  } catch (_) {
    // Unparseable custom stub. Return an empty set — see
    // getStubMemberNames()'s doc block for why "assume nothing is
    // implemented" is the safe direction for an extraction failure to fail
    // toward, given this feeds a build-failing check.
    return names;
  }

  const topLevelObjectLiterals = collectTopLevelObjectLiterals(ast);

  for (const node of ast.body) {
    if (node.type === 'ExportNamedDeclaration') {
      collectNamedExportNames(node, names);
    } else if (node.type === 'ExportDefaultDeclaration') {
      collectDefaultExportNames(node, topLevelObjectLiterals, names);
    }
  }

  return names;
}

const builtinMemberCache = new Map();

/**
 * Member names for a built-in stub (SIMPLE_STUBS or RICH_STUBS), memoized —
 * these never change within a process, so there's no reason to re-parse per
 * call site. A SIMPLE_STUBS name always yields an empty set (EMPTY_MODULE
 * exports nothing); unknown names also yield an empty set, matching
 * loadRichStub()'s own "unknown → EMPTY_MODULE" fallback.
 *
 * @param {string} mod - bare built-in module name
 * @returns {Set<string>}
 */
function getBuiltinStubMemberNames(mod) {
  if (builtinMemberCache.has(mod)) return builtinMemberCache.get(mod);

  const source = RICH_STUBS.has(mod) ? loadRichStub(mod) : EMPTY_MODULE;
  const names = extractStubMemberNames(source);

  builtinMemberCache.set(mod, names);
  return names;
}

/**
 * Member names accessible off `require(mod)`/`import mod from mod` for a
 * given module name, honoring the same site-stub-overrides-built-in
 * precedence as resolveId() above (a site's custom stub for a name already
 * in SIMPLE_STUBS/RICH_STUBS replaces the built-in one entirely).
 *
 * Returns null when `mod` isn't a stubbed built-in AND has no custom stub —
 * i.e. this module isn't intercepted at all, so there's nothing to check
 * (a real npm package's actual exports, not a stub's).
 *
 * @param {string} mod - bare module name (already stripped of any node: prefix)
 * @param {object} [customStubs={}] - bundlerConfig().browserStubs
 * @returns {Set<string>|null}
 */
function getStubMemberNames(mod, customStubs = {}) {
  if (customStubs && Object.prototype.hasOwnProperty.call(customStubs, mod)) {
    const custom = customStubs[mod];

    // null means "simple empty stub" per the browserStubs contract in this
    // file's doc block — same shape as EMPTY_MODULE, so no members.
    return custom === null || custom === undefined ? new Set() : extractStubMemberNames(custom);
  }

  if (SIMPLE_STUBS.has(mod) || RICH_STUBS.has(mod)) return getBuiltinStubMemberNames(mod);

  return null;
}

/**
 * Is `mod` (a bare, already node:-stripped module name) one this plugin
 * intercepts — as a built-in stub or a site's custom stub? Mirrors the
 * matching logic in resolveId() above; kept as its own function so
 * scanStubMemberGaps() (scripts.js) can decide whether a given require()/
 * import target is worth checking without duplicating that logic.
 *
 * @param {string} mod
 * @param {object} [customStubs={}]
 * @returns {boolean}
 */
function isStubbedModule(mod, customStubs = {}) {
  return SIMPLE_STUBS.has(mod) || RICH_STUBS.has(mod)
    || customStubs && Object.prototype.hasOwnProperty.call(customStubs, mod);
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
// Attached rather than destructured out to a separate exports object so the
// existing `const viteBrowserCompatPlugin = require('./plugins/browser-compat')`
// call-as-a-function usage keeps working unchanged for every existing caller.
module.exports.getStubMemberNames = getStubMemberNames;
module.exports.isStubbedModule = isStubbedModule;

/* eslint-env jest */

'use strict';

const crypto = require('crypto');
const vm = require('vm');
const { rollup } = require('rollup');
const { nodeResolve } = require('@rollup/plugin-node-resolve');
const commonjs = require('@rollup/plugin-commonjs');
const viteBrowserCompatPlugin = require('./browser-compat');

// Bundling real npm packages through Rollup is slower than a unit test.
jest.setTimeout(30000);

// ── why this file exists ──────────────────────────────────────────────────────
//
// browser-compat.test.js unit-tests each stub in isolation. This file is the
// end-to-end guard: it runs the SAME plugin pipeline claycli uses for the
// kiln-edit bundle (browser-compat + node-resolve + commonjs) over the exact
// libraries that have crashed edit mode before, then evaluates the emitted
// bundle in a Buffer-less context that mimics the browser.
//
// The original crash (claycli#253) was `safe-buffer` running
// `SafeBuffer.prototype = Object.create(Buffer.prototype)` at module evaluation
// against a shape-broken buffer stub. `create-hash` is the real path that pulled
// safe-buffer into the kiln bundle (crypto-browserify → create-hash → …), and it
// also drags cipher-base/sha.js/hash-base/readable-stream, which subclass the
// stream and events stubs at eval. If any stub regresses to a non-import-safe
// shape, evaluating this bundle throws — turning "an editor sees a console error"
// into "CI is red".

/**
 * Provide a virtual entry module to Rollup so the fixture source lives inline
 * (no temp files) while still resolving real packages from node_modules.
 *
 * @param {string} code - ESM source for the entry module
 * @returns {object} a Rollup plugin
 */
function virtualEntry(code) {
  const ID = '\0clay-smoke-entry';

  return {
    name: 'clay-smoke-entry',
    resolveId(id) {
      return id === ID ? ID : null;
    },
    load(id) {
      return id === ID ? code : null;
    },
  };
}

/**
 * Bundle an ESM entry through the real kiln-edit browser pipeline and return the
 * emitted CJS code.
 *
 * @param {string} entryCode - ESM source importing the libraries under test
 * @returns {Promise<string>} the generated bundle source
 */
async function bundleForBrowser(entryCode) {
  const bundle = await rollup({
    input: '\0clay-smoke-entry',
    // Silence expected browser-bundle noise (circular deps in readable-stream,
    // `this` rewrites in CJS). A stub-shape regression surfaces at eval, not here.
    onwarn() {},
    plugins: [
      virtualEntry(entryCode),
      viteBrowserCompatPlugin(),
      nodeResolve({ browser: true, preferBuiltins: false, exportConditions: ['browser', 'default'] }),
      commonjs({ transformMixedEsModules: true, requireReturnsDefault: 'preferred' }),
    ],
  });

  try {
    const { output } = await bundle.generate({ format: 'cjs', inlineDynamicImports: true, exports: 'named' });

    return output[0].code;
  } finally {
    await bundle.close();
  }
}

/**
 * Evaluate a generated CJS bundle in an isolated context that mimics the browser.
 * `globalThis` inside the context is the sandbox itself, so omitting `Buffer`
 * forces the buffer stub's fallback path — exactly the browser condition that
 * crashed edit mode.
 *
 * @param {string} code - the generated bundle source
 * @param {object} [opts]
 * @param {boolean} [opts.withBuffer=false] - expose a real global Buffer (tests the prefer-global path)
 * @returns {object} the bundle's module.exports
 */
function evalBundle(code, opts) {
  const withBuffer = Boolean(opts && opts.withBuffer);
  const moduleObj = { exports: {} };
  const sandbox = {
    module: moduleObj,
    exports: moduleObj.exports,
    console,
    setTimeout,
    clearTimeout,
    TextEncoder,
    TextDecoder,
    process: {
      env: {},
      browser: true,
      argv: [],
      version: 'v18.0.0',
      versions: { node: '18.0.0' },
      platform: 'browser',
      nextTick: (cb, ...args) => Promise.resolve().then(() => cb(...args)),
    },
  };

  // Only the prefer-global test provides a real Buffer; the default path leaves
  // globalThis.Buffer undefined to reproduce the browser.
  if (withBuffer) sandbox.Buffer = Buffer;

  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { timeout: 5000 });

  return moduleObj.exports;
}

// safe-buffer is the exact library and version (5.2.1) behind claycli#253;
// create-hash is the real crypto path that pulls it into the kiln bundle.
const ENTRY = `
  import { Buffer as SafeBuffer } from 'safe-buffer';
  import createHash from 'create-hash';

  export var safeBufferType = typeof SafeBuffer;
  export var safeBufferFromWorks = typeof SafeBuffer.from === 'function';
  export function makeHash() { return createHash('sha256'); }
  export function sha256Hex(input) { return createHash('sha256').update(input).digest('hex'); }
`;

describe('browser-compat kiln-edit bundle smoke test', () => {
  let bundledCode;

  beforeAll(async () => {
    bundledCode = await bundleForBrowser(ENTRY);
  });

  it('evaluates the danger libs with no global Buffer without crashing (safe-buffer #253 regression)', () => {
    let exports;

    // The whole point: a shape-broken stub throws HERE, at module evaluation.
    expect(() => { exports = evalBundle(bundledCode, { withBuffer: false }); }).not.toThrow();
    expect(exports.safeBufferType).toBe('function');
    expect(exports.safeBufferFromWorks).toBe(true);
    // Constructing a hash exercises the stream/events stubs (cipher-base/sha.js
    // subclass them) and the string_decoder stub, and must not throw. We stop at
    // construction on purpose: actually digesting needs a byte-capable Buffer
    // (writeUInt32BE, toString(enc)) that the minimal fallback shim cannot
    // provide — that path is covered, with a real Buffer, by the next test.
    expect(() => exports.makeHash()).not.toThrow();
  });

  // Real crypto (create-hash / crypto-browserify's createHmac) only computes a
  // correct digest when the page exposes a real global Buffer; the buffer stub
  // defers to it (rule 2). With no global Buffer, `.digest()` throws
  // "writeUInt32BE is not a function" — so any browser crypto feature must ensure
  // a Buffer global exists or use Web Crypto (crypto.subtle) instead.
  it('computes a correct hash when a real global Buffer is present (prefer-global path is functional)', () => {
    const exports = evalBundle(bundledCode, { withBuffer: true });
    const expected = crypto.createHash('sha256').update('abc').digest('hex');

    expect(exports.sha256Hex('abc')).toBe(expected);
  });
});

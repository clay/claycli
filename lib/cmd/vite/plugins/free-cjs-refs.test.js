/* eslint-env jest */
'use strict';

const { parseAst } = require('rollup/parseAst');
const viteFreeCommonjsRefsPlugin = require('./free-cjs-refs');
const { findFreeCommonjsRefs, formatFreeCommonjsRefs } = viteFreeCommonjsRefsPlugin;

// The shape that broke Kiln edit mode: randomfill/browser.js after claycli's
// `process.browser` define, with the `if` branch left unconverted by
// @rollup/plugin-commonjs 26.x.  The else branch was converted correctly.
const LEAKED_RANDOMFILL = [
  'var crypto$2 = globalThis.crypto;',
  'if (crypto$2 && crypto$2.getRandomValues || false) {',
  '  exports.randomFill = randomFill;',
  '  exports.randomFillSync = randomFillSync;',
  '} else {',
  '  browser.randomFill = oldBrowser;',
  '}',
].join('\n');

/**
 * Run the plugin's renderChunk the way Rollup does: with a plugin context
 * whose error() throws.
 *
 * @param {string} code
 * @param {object} chunk
 * @returns {{ result: *, ctx: object }}
 */
function renderChunk(code, chunk) {
  const plugin = viteFreeCommonjsRefsPlugin({ cwd: '/project' });
  const ctx = {
    parse: input => parseAst(input),
    error: jest.fn(message => { throw new Error(message); }),
    warn: jest.fn(),
  };

  return { result: plugin.renderChunk.call(ctx, code, chunk), ctx };
}

describe('findFreeCommonjsRefs', () => {
  it.each([
    ['a free exports write', 'exports.a = 1;', ['exports']],
    ['a free module.exports write', 'module.exports = 1;', ['module']],
    ['a free require call', 'require("x");', ['require']],
    ['a computed member key', 'a[module] = 1;', ['module']],
    ['a shorthand property value', 'x = { module };', ['module']],
    ['a class field value', 'class A { x = module; }', ['module']],
    ['a default parameter value', 'function f(a = module) {}', ['module']],
    ['a destructuring assignment target', '({ module } = o);', ['module']],
    ['a var declared only inside another function', 'function f() { var exports = {}; } exports.a = 1;', ['exports']],
    ['a let declared only in an inner block', '{ let module = 1; } module.x = 1;', ['module']],
    ['a guard on a different name', 'if (typeof exports === "object") { module.exports = 1; }', ['module']],
    ['a branch that runs when the name is undefined', 'if (typeof module === "undefined") module.exports = 1;', ['module']],
    ['the else of a "defined" check', 'if (typeof module === "object") {} else { module.exports = 1; }', ['module']],
    ['&& after a negative check', 'typeof require !== "function" && require("x");', ['require']],
    ['a ternary branch that runs when undefined', 'typeof module === "undefined" ? module.exports : 0;', ['module']],
    ['|| after a positive check', 'typeof module === "object" || module.exports;', ['module']],
    ['a check that proves nothing about the name', 'if (typeof module === "undefined" || cond) { module.exports = 1; }', ['module']],
    ['a ?? right side', 'typeof module === "object" ?? module.exports;', ['module']],
    ['a bare typeof as the test', 'if (typeof module) { module.exports = 1; }', ['module']],
    ['a while body that runs when undefined', 'while (typeof require === "undefined") { require("x"); break; }', ['require']],
    ['a for body that runs when undefined', 'for (var i = 0; typeof module === "undefined"; i++) { module.exports = i; break; }', ['module']],
    ['a do-while body, which runs before the first test', 'do { require("x"); } while (typeof require === "function");', ['require']],
    ['a for init, which runs before the test', 'for (var r = require("x"); typeof require === "function";) { break; }', ['require']],
    ['a for update, which runs after the body', 'for (var i = 0; typeof module === "object"; module.exports = i++) {}', ['module']],
    ['the loop test itself', 'while (module.exports) { break; }', ['module']],
    ['a for-in body', 'for (var i in o) { module.exports = i; }', ['module']],
    ['a for body with no test', 'for (;;) { module.exports = 1; break; }', ['module']],
    ['the randomfill leak', LEAKED_RANDOMFILL, ['exports', 'exports']],
  ])('reports %s', (_, code, names) => {
    expect(findFreeCommonjsRefs(code).map(r => r.name)).toEqual(names);
  });

  it.each([
    ['property access on another object', 'a.exports = 1; a.module; a.require(); a?.exports;'],
    ['object literal keys and methods', 'x = { exports: 1, module() {}, get require() {} };'],
    ['class members', 'class A { module = 1; require() {} static exports = 2; }'],
    ['the operand of typeof', 'typeof module; typeof exports === "object";'],
    ['a && guard', 'typeof module === "object" && module.exports && (module.exports = 1);'],
    ['an if guard', 'if (typeof require === "function") { require("x"); }'],
    ['a ternary guard', 'var r = typeof require === "function" ? require("x") : null;'],
    ['a negative check with ||', 'typeof module === "undefined" || module.exports;'],
    ['a !== undefined check with &&', 'typeof module !== "undefined" && module.exports;'],
    ['the else of an undefined check', 'if (typeof module === "undefined") { x = 1; } else { module.exports = 1; }'],
    ['a loose comparison', 'typeof module == "object" && module.exports;'],
    ['the literal on the left', '"undefined" !== typeof module && module.exports;'],
    ['a negated check', '!(typeof module === "undefined") && module.exports;'],
    ['a negated undefined check', '!(typeof module !== "undefined") || module.exports;'],
    ['a nested && chain', 'typeof module === "object" && module && module.exports;'],
    ['one side of an && test', 'if (cond && typeof module !== "undefined") { module.exports = 1; }'],
    ['both sides of an || test', 'if (typeof module === "object" || typeof module === "function") { module.exports = 1; }'],
    ['a guard on an enclosing branch', 'if (typeof module === "object") { if (x) { module.exports = 1; } }'],
    ['a while body behind a typeof test', 'while (typeof require === "function") { require("x"); break; }'],
    ['a while body behind a !== undefined test', 'while (typeof module !== "undefined") { module.exports = 1; break; }'],
    ['a for body behind a typeof test', 'for (var i = 0; typeof module === "object"; i++) { module.exports = i; }'],
    ['a for test guarded within itself', 'for (; typeof module === "object" && module.exports;) {}'],
    ['a var declaration', 'var exports = {}; exports.a = 1;'],
    ['a var hoisted from later in the function', 'function f() { exports.a = 1; var exports = {}; }'],
    ['parameters, including patterns', 'function f(module, { exports }, [require]) { module; exports; require; }'],
    ['an arrow parameter', 'const f = (exports) => exports.a;'],
    ['a named function expression', 'const f = function require() { return require; };'],
    ['a hoisted function declaration', 'require(); function require() {}'],
    ['a named class expression', 'const C = class module { m() { return module; } };'],
    ['a catch parameter', 'try {} catch (exports) { exports.a = 1; }'],
    ['a for-of binding', 'for (let module of []) { module; }'],
    ['an import binding', 'import { x as module } from "./a.js"; module();'],
    ['an export alias', 'const a = 1; export { a as module };'],
    ['a declared local exported under its own name', 'const module = 1; export { module };'],
    ['a named re-export from another module', 'export { module } from "./external.js";'],
    ['a renamed re-export from another module', 'export { exports as require } from "./external.js";'],
    ['a namespace re-export from another module', 'export * as module from "./external.js";'],
    ['a label', 'module: for (;;) { break module; }'],
    ['a var in a class static block', 'class A { static { var exports = 1; exports; } }'],
    ['strings and comments', '"module.exports = 1"; // require(x)'],
  ])('ignores %s', (_, code) => {
    expect(findFreeCommonjsRefs(code)).toEqual([]);
  });

  it('returns positions in source order', () => {
    const code = 'module.exports = 1;\nexports.a = 2;';

    expect(findFreeCommonjsRefs(code)).toEqual([
      { name: 'module', start: 0, end: 6 },
      { name: 'exports', start: 20, end: 27 },
    ]);
  });

  it('skips parsing when no candidate name appears', () => {
    const parse = jest.fn();

    expect(findFreeCommonjsRefs('var a = 1;', parse)).toEqual([]);
    expect(parse).not.toHaveBeenCalled();
  });
});

describe('formatFreeCommonjsRefs', () => {
  it('names the chunk, position, source module and line', () => {
    const refs = findFreeCommonjsRefs(LEAKED_RANDOMFILL);
    const message = formatFreeCommonjsRefs('.clay/vite-kiln-edit-init-[hash].js', LEAKED_RANDOMFILL, refs, {
      cwd: '/project',
      modules: {
        '/project/components/foo/model.js': { code: 'var x = 1;' },
        '/project/node_modules/randomfill/browser.js?commonjs-exports': { code: LEAKED_RANDOMFILL },
      },
    });

    expect(message).toContain('.clay/vite-kiln-edit-init-[hash].js references CommonJS exports without defining it (2 place(s))');
    expect(message).toContain('`exports` at 3:2 in node_modules/randomfill/browser.js');
    expect(message).toContain('exports.randomFill = randomFill;');
    expect(message).toContain('`exports` at 4:2 in node_modules/randomfill/browser.js');
    expect(message).not.toContain('model.js');
  });

  it('caps the list and says how many more there are', () => {
    const code = Array.from({ length: 12 }, (_, i) => `exports.a${i} = ${i};`).join('\n');
    const message = formatFreeCommonjsRefs('x.js', code, findFreeCommonjsRefs(code));

    expect(message.match(/^ {2}- `exports`/gm)).toHaveLength(10);
    expect(message).toContain('… and 2 more');
  });
});

describe('viteFreeCommonjsRefsPlugin', () => {
  it('runs after other plugins', () => {
    expect(viteFreeCommonjsRefsPlugin()).toMatchObject({ name: 'clay-vite-free-cjs-refs', enforce: 'post' });
  });

  it('passes a clean chunk through unchanged', () => {
    const { result, ctx } = renderChunk('import { a } from "./a.js";\nvar b = { exports: {} };\nb.exports.a = a;', {
      fileName: 'chunks/clean-!~{002}~.js',
      modules: {},
    });

    expect(result).toBeNull();
    expect(ctx.error).not.toHaveBeenCalled();
  });

  it('fails the build on a seeded bad chunk and names the source module', () => {
    const code = `import "./_env-init.js";\n${LEAKED_RANDOMFILL}\nexport const y = 1;`;
    const chunk = {
      fileName: '.clay/vite-kiln-edit-init-!~{001}~.js',
      modules: { '/project/node_modules/randomfill/browser.js': { code: LEAKED_RANDOMFILL } },
    };

    expect(() => renderChunk(code, chunk)).toThrow(/vite-kiln-edit-init-\[hash\]\.js references CommonJS exports/);
    expect(() => renderChunk(code, chunk)).toThrow(/in node_modules\/randomfill\/browser\.js/);
  });

  it('warns instead of failing when the chunk cannot be parsed', () => {
    const { result, ctx } = renderChunk('exports.a = ;', { fileName: 'broken.js', modules: {} });

    expect(result).toBeNull();
    expect(ctx.error).not.toHaveBeenCalled();
    expect(ctx.warn).toHaveBeenCalledWith(expect.stringContaining('could not scan broken.js'));
  });
});

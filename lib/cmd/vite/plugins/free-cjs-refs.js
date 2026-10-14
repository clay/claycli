'use strict';

const path = require('path');
const { parseAst } = require('rollup/parseAst');

/**
 * Build-time guard against CommonJS variables leaking into ESM output.
 *
 * ── Why this exists ──────────────────────────────────────────────────────────
 *
 * @rollup/plugin-commonjs rewrites `exports`, `module` and `require` in every
 * CommonJS module it converts.  When it skips part of a module, the untouched
 * reference survives into the output chunk as a free (undeclared) variable.
 * Browsers have no such global, so the chunk throws
 * "ReferenceError: exports is not defined" as soon as that line runs.
 *
 * This happened in practice: the commonjs copy bundled with Vite 5 (26.x)
 * folded randomfill's `(crypto && crypto.getRandomValues) || false` (after the
 * `process.browser` define) to "always false", treated the `if` branch as dead
 * and never rewrote the `exports.randomFill = …` inside it.  Kiln edit mode
 * threw on load and no site Kiln plugin registered.
 *
 * Nothing at build time reported it.  Vite drops esbuild's
 * `commonjs-variable-in-esm` warning, and esbuild's minifier sometimes hides
 * the leak: when a chunk has no ESM syntax (no import/export, no
 * `import.meta`), esbuild wraps the whole chunk in its own CommonJS helper,
 * where the stray `exports` binds to the helper's parameter and silently goes
 * nowhere.  Adding one `import()` to the kiln graph removed that wrapper and
 * turned the silent bug into a crash.  So the check has to run on the chunk
 * Rollup rendered, before minification — a clean result after the wrapper is
 * applied proves nothing.
 *
 * ── What counts as a leak ────────────────────────────────────────────────────
 *
 * A read or write of `exports`, `module` or `require` that no enclosing scope
 * in the chunk declares.  Two shapes are allowed because they cannot throw:
 *
 *   - the operand of `typeof` (`typeof module !== 'undefined'`)
 *   - a reference that only runs when a `typeof` check of the same name proves
 *     it exists, as in UMD and isomorphic feature detection:
 *       typeof module === 'object' && module.exports
 *       if (typeof require === 'function') { require('x'); }
 *     This covers if/else, ternaries, `&&`/`||`, and `while`/`for` bodies (not
 *     a `for` update, which runs after the body).  The direction matters:
 *     `typeof module === 'undefined' && module.exports` and the `else` of a
 *     "defined" check run when the name is absent, so they are reported.
 *
 *     A guard is trusted for the whole branch it covers.  Code that removes the
 *     global between the check and the use (`delete globalThis.module`) is not
 *     modelled: it applies to every branch kind and to any call, and a
 *     CommonJS conversion never produces it.
 *
 * ── How ──────────────────────────────────────────────────────────────────────
 *
 * A scope walk over Rollup's own parser output (rollup/parseAst), limited to
 * the three names.  Chunks that never mention them skip the parse entirely.
 */

const CJS_NAMES = new Set(['exports', 'module', 'require']);
const CANDIDATE_RE = /\b(?:exports|module|require)\b/;

const FUNCTION_TYPES = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression']);

// Nodes that hold `var` declarations.
const VAR_SCOPE_TYPES = new Set(['Program', 'StaticBlock', ...FUNCTION_TYPES]);

// Nodes that hold let/const/class declarations, and function declarations
// (output chunks are ES modules, so always strict: block-scoped functions).
const BLOCK_SCOPE_TYPES = new Set([
  ...VAR_SCOPE_TYPES,
  'BlockStatement',
  'SwitchStatement',
  'ForStatement',
  'ForInStatement',
  'ForOfStatement',
]);

const MAX_REPORTED = 10;

/**
 * Collect the Identifier nodes a binding pattern declares.  Default values
 * and computed keys are expressions, not bindings, so they are skipped here
 * and visited as ordinary references by the walk.
 *
 * @param {object}   pattern
 * @param {object[]} out
 * @returns {object[]} out
 */
function patternIdentifiers(pattern, out = []) {
  if (!pattern) return out;

  switch (pattern.type) {
    case 'Identifier':
      out.push(pattern);
      break;
    case 'ObjectPattern':
      pattern.properties.forEach(p => patternIdentifiers(p.type === 'RestElement' ? p.argument : p.value, out));
      break;
    case 'ArrayPattern':
      pattern.elements.forEach(el => patternIdentifiers(el, out));
      break;
    case 'AssignmentPattern':
      patternIdentifiers(pattern.left, out);
      break;
    case 'RestElement':
      patternIdentifiers(pattern.argument, out);
      break;
    default:
      // MemberExpression targets in assignment patterns bind nothing.
  }

  return out;
}

/**
 * Nearest ancestor (starting at `item`) whose node type is in `types`.
 *
 * @param {object} item   walk frame `{ node, parent }`
 * @param {Set}    types
 * @returns {object|null} node
 */
function nearestScope(item, types) {
  for (let cur = item; cur; cur = cur.parent) {
    if (types.has(cur.node.type)) return cur.node;
  }

  return null;
}

/**
 * Bindings scoped to a function or class node itself: its parameters, plus
 * its own name for function/class expressions.
 *
 * @param {object}  node
 * @param {boolean} [ownName]  include node.id (expressions only)
 * @returns {object[]}
 */
function functionOwnBindings(node, ownName) {
  const ids = [];

  if (ownName && node.id) ids.push(node.id);
  (node.params || []).forEach(p => patternIdentifiers(p, ids));

  return [{ ids, scope: node }];
}

/**
 * A function or class declaration: its name binds in the enclosing block,
 * its parameters in the function itself.
 *
 * @param {object} node
 * @param {object} item  walk frame for `node`
 * @returns {object[]}
 */
function declaredFunctionOrClass(node, item) {
  return [
    { ids: node.id ? [node.id] : [], scope: nearestScope(item.parent, BLOCK_SCOPE_TYPES) },
    ...functionOwnBindings(node),
  ];
}

const ownBindings = node => functionOwnBindings(node, true);

// Node type → (node, walk frame) → bindings it introduces, as `{ ids, scope }`
// pairs: the declared Identifier nodes and the scope node they belong to.
const DECLARATIONS = new Map([
  ['VariableDeclaration', (node, item) => {
    const scope = nearestScope(item.parent, node.kind === 'var' ? VAR_SCOPE_TYPES : BLOCK_SCOPE_TYPES);

    return node.declarations.map(d => ({ ids: patternIdentifiers(d.id), scope }));
  }],
  ['FunctionDeclaration', declaredFunctionOrClass],
  ['ClassDeclaration', declaredFunctionOrClass],
  ['FunctionExpression', ownBindings],
  ['ArrowFunctionExpression', ownBindings],
  ['ClassExpression', ownBindings],
  ['CatchClause', node => [{ ids: patternIdentifiers(node.param), scope: node }]],
  ['ImportDeclaration', (node, item) => [
    { ids: node.specifiers.map(s => s.local), scope: nearestScope(item, VAR_SCOPE_TYPES) },
  ]],
]);

const keyedMember = (node, parent) => parent.computed || parent.value === node;
const never = () => false;

// Parent type → whether an Identifier child is used as a variable there, as
// opposed to a property name, label or import/export alias.  Parents not
// listed always make it a reference.
const REFERENCE_RULES = new Map([
  ['MemberExpression', (node, parent) => parent.computed || parent.object === node],
  ['Property', keyedMember],
  ['PropertyDefinition', keyedMember],
  ['MethodDefinition', keyedMember],
  ['ExportSpecifier', (node, parent) => parent.local === node],
  ['ImportSpecifier', never],
  ['ImportDefaultSpecifier', never],
  ['ImportNamespaceSpecifier', never],
  ['ImportAttribute', never],
  ['LabeledStatement', never],
  ['BreakStatement', never],
  ['ContinueStatement', never],
  ['MetaProperty', never],
]);

/**
 * True when `node` (an Identifier) is used as a variable under `parent`.
 *
 * @param {object} node
 * @param {object} parent
 * @returns {boolean}
 */
function isReference(node, parent) {
  const rule = REFERENCE_RULES.get(parent.type);

  return rule ? rule(node, parent) : true;
}

/**
 * `typeof <name>` compared with a string literal, in either operand order:
 * `{ literal, equals }`, where `equals` is false for `!==`/`!=`.  Null for
 * anything else.
 *
 * @param {object} test
 * @param {string} name
 * @returns {{literal: string, equals: boolean}|null}
 */
function typeofComparison(test, name) {
  if (test.type !== 'BinaryExpression' || !/^[!=]==?$/.test(test.operator)) return null;

  const isTypeof = n => n.type === 'UnaryExpression' && n.operator === 'typeof' &&
    n.argument.type === 'Identifier' && n.argument.name === name;
  const isString = n => n.type === 'Literal' && typeof n.value === 'string';

  const other = [[test.left, test.right], [test.right, test.left]]
    .map(([a, b]) => isTypeof(a) && isString(b) ? b.value : null)
    .find(value => value !== null);

  return other === undefined ? null : { literal: other, equals: test.operator[0] === '=' };
}

// Expression type → (test, name, outcome) → true when `test` evaluating to
// `outcome` proves `name` is defined.  Every rule is sufficient, not exact:
// when unsure it answers false, which reports the reference.
const IMPLIES_DEFINED = {
  BinaryExpression(test, name, outcome) {
    const cmp = typeofComparison(test, name);

    if (!cmp) return false;

    // `typeof x === L` holds on this path when outcome === equals.  On that
    // path x is defined unless L is 'undefined'; on the other, only if L is.
    return outcome === cmp.equals ? cmp.literal !== 'undefined' : cmp.literal === 'undefined';
  },
  UnaryExpression(test, name, outcome) {
    return test.operator === '!' && impliesDefined(test.argument, name, !outcome);
  },
  LogicalExpression(test, name, outcome) {
    if (test.operator === '??') return false;

    // `&&` is true only if both sides are, `||` is false only if both are:
    // either side's evidence is enough.  The other outcomes could come from
    // either side, so both must carry the evidence.
    const [left, right] = [test.left, test.right].map(side => impliesDefined(side, name, outcome));
    const isAnd = test.operator === '&&';
    const bothSidesHaveOutcome = isAnd === outcome;

    return bothSidesHaveOutcome ? left || right : left && right;
  },
};

/**
 * True when `test` evaluating to `outcome` proves `name` is defined.
 *
 * @param {object}  test
 * @param {string}  name
 * @param {boolean} outcome
 * @returns {boolean}
 */
function impliesDefined(test, name, outcome) {
  const rule = IMPLIES_DEFINED[test.type];

  return rule ? rule(test, name, outcome) : false;
}

// `if`/ternary: the consequent runs when the test is true, the alternate when
// it is false.  The test itself is not conditional.
const ifBranch = (parent, child) => {
  if (child === parent.consequent) return { test: parent.test, outcome: true };

  return child === parent.alternate ? { test: parent.test, outcome: false } : null;
};

// `a && b` runs b when a is true, `a || b` when a is false.  `a ?? b` runs b
// on null/undefined, which no typeof test yields.
const logicalBranch = (parent, child) => {
  if (child !== parent.right || parent.operator === '??') return null;

  return { test: parent.left, outcome: parent.operator === '&&' };
};

// `while`/`for`: the body runs right after a true test, like an `if` body.
// Not conditional: a `for` init (runs before the test), a `do … while` body
// (runs before the first test) and a `for` update (runs after the whole body,
// which may have changed things, without a re-check).
const loopBranch = (parent, child) => parent.test && child === parent.body ? { test: parent.test, outcome: true } : null;

// Parent type → (parent, child) → `{ test, outcome }` or null.
const BRANCH_RULES = {
  IfStatement: ifBranch,
  ConditionalExpression: ifBranch,
  LogicalExpression: logicalBranch,
  WhileStatement: loopBranch,
  ForStatement: loopBranch,
};

/**
 * The branch test that decides whether `child` runs, and the value it must
 * have for `child` to run: `{ test, outcome }`, or null when `child` is not
 * a conditionally run part of `parent`.
 *
 * @param {object} parent
 * @param {object} child
 * @returns {{test: object, outcome: boolean}|null}
 */
function branchCondition(parent, child) {
  const rule = BRANCH_RULES[parent.type];

  return rule ? rule(parent, child) : null;
}

/**
 * True when a reference only runs on a path where a `typeof` check proves its
 * own name is defined, e.g. `typeof module === 'object' && module.exports` or
 * `if (typeof require !== 'undefined') { require('x'); }`.  Branches that run
 * when the name is absent (`typeof module === 'undefined' && module.exports`,
 * or the `else` of a "defined" check) are not guarded.
 *
 * Early exits (`if (typeof module === 'undefined') return;` followed by uses)
 * are not understood, so those references are reported.
 *
 * @param {object} item  walk frame of the reference
 * @param {string} name
 * @returns {boolean}
 */
function isTypeofGuarded(item, name) {
  for (let cur = item; cur.parent; cur = cur.parent) {
    const condition = branchCondition(cur.parent.node, cur.node);

    if (condition && impliesDefined(condition.test, name, condition.outcome)) return true;
  }

  return false;
}

/**
 * True when some scope enclosing the reference declares `name`.
 *
 * @param {object} item      walk frame of the reference
 * @param {string} name
 * @param {Map}    declared  scope node → Set of declared names
 * @returns {boolean}
 */
function isDeclared(item, name, declared) {
  for (let cur = item; cur; cur = cur.parent) {
    const names = declared.get(cur.node);

    if (names && names.has(name)) return true;
  }

  return false;
}

/**
 * True for an ESTree node (as opposed to a primitive or a plain object such
 * as a regex literal's `regex` field).
 *
 * @param {*} value
 * @returns {boolean}
 */
function isNode(value) {
  return value !== null && typeof value === 'object' && typeof value.type === 'string';
}

/**
 * Push the AST child nodes of `node` onto `stack`.
 *
 * @param {object}   node
 * @param {object[]} stack
 * @param {function} [wrap]  maps each child before pushing
 */
function pushChildren(node, stack, wrap = c => c) {
  for (const key of Object.keys(node)) {
    const value = node[key];

    if (Array.isArray(value)) {
      value.forEach(child => isNode(child) && stack.push(wrap(child)));
    } else if (isNode(value)) {
      stack.push(wrap(value));
    }
  }
}

/**
 * Record the CommonJS-named bindings `node` introduces.
 *
 * @param {object} node
 * @param {object} item      walk frame for `node`
 * @param {Map}    declared  scope node → Set of names (mutated)
 * @param {Set}    bindingIds  declared Identifier nodes (mutated)
 */
function recordDeclarations(node, item, declared, bindingIds) {
  const declarations = DECLARATIONS.get(node.type);

  if (!declarations) return;

  for (const { ids, scope } of declarations(node, item)) {
    for (const id of ids) {
      if (!CJS_NAMES.has(id.name) || !scope) continue;
      bindingIds.add(id);
      if (!declared.has(scope)) declared.set(scope, new Set());
      declared.get(scope).add(id.name);
    }
  }
}

/**
 * `export { a } from './x.js'` and `export * as a from './x.js'`: the names
 * inside belong to the other module, so none of them is a local variable.
 *
 * @param {object} node
 * @returns {boolean}
 */
function isReExport(node) {
  return (node.type === 'ExportNamedDeclaration' || node.type === 'ExportAllDeclaration') && node.source != null;
}

/**
 * Walk the AST once, collecting CommonJS-named declarations and every
 * Identifier that references one of the names.
 *
 * Iterative (explicit stack) so deeply nested expressions cannot overflow the
 * call stack.  Each frame links to its parent frame, which gives every
 * reference its full ancestor chain without copying.
 *
 * @param {object} ast
 * @returns {{ declared: Map, refs: object[] }}
 */
function collect(ast) {
  const declared = new Map();
  const bindingIds = new Set();
  const refs = [];
  const stack = [{ node: ast, parent: null }];

  while (stack.length) {
    const item = stack.pop();
    const { node } = item;

    if (node.type === 'Identifier') {
      if (CJS_NAMES.has(node.name)) refs.push(item);
      continue;
    }

    if (isReExport(node)) continue;

    recordDeclarations(node, item, declared, bindingIds);
    pushChildren(node, stack, child => ({ node: child, parent: item }));
  }

  return { declared, refs: refs.filter(item => !bindingIds.has(item.node)) };
}

/**
 * Find references to `exports`, `module` or `require` that no scope in
 * `code` declares and that are not typeof-guarded.
 *
 * @param {string}   code   an ES module (a rendered chunk)
 * @param {function} [parse=parseAst]  `(code) => ESTree Program`
 * @returns {Array<{name: string, start: number, end: number}>} sorted by position
 */
function findFreeCommonjsRefs(code, parse = parseAst) {
  if (!CANDIDATE_RE.test(code)) return [];

  const { declared, refs } = collect(parse(code));

  return refs
    .filter(item => {
      const { node } = item;
      const parent = item.parent.node; // an Identifier is never the Program root

      if (!isReference(node, parent)) return false;
      if (parent.type === 'UnaryExpression' && parent.operator === 'typeof') return false;

      return !isDeclared(item, node.name, declared) && !isTypeofGuarded(item, node.name);
    })
    .map(({ node }) => ({ name: node.name, start: node.start, end: node.end }))
    .sort((a, b) => a.start - b.start);
}

/**
 * 1-based line and 0-based column of `offset` in `code`.
 *
 * @param {string} code
 * @param {number} offset
 * @returns {{line: number, column: number}}
 */
function lineColumn(code, offset) {
  const before = code.slice(0, offset);
  const lastNewline = before.lastIndexOf('\n');

  return { line: before.split('\n').length, column: offset - lastNewline - 1 };
}

/**
 * Up to `radius` characters either side of `[start, end)`, clipped to the
 * line.
 *
 * @param {string} code
 * @param {object} ref  `{ start, end }`
 * @param {number} radius
 * @returns {string}
 */
function snippetAround(code, ref, radius) {
  const lineStart = code.lastIndexOf('\n', ref.start - 1) + 1;
  const lineEndIdx = code.indexOf('\n', ref.end);
  const lineEnd = lineEndIdx === -1 ? code.length : lineEndIdx;

  return code.slice(Math.max(lineStart, ref.start - radius), Math.min(lineEnd, ref.end + radius));
}

/**
 * Turn a Rollup module id into a short, readable source path:
 * no `\0` prefix, no `?query`, relative to `cwd` when inside it.
 *
 * @param {string} id
 * @param {string} cwd
 * @returns {string}
 */
function displayModuleId(id, cwd) {
  const clean = id.replace(/^\0/, '').replace(/\?.*$/, '');
  const rel = path.relative(cwd, clean);

  return rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? rel.replace(/\\/g, '/') : clean;
}

/**
 * The module(s) of a rendered chunk whose code contains the text around a
 * reference.  Starts with a narrow window and widens it until one module
 * matches; if widening runs past the module's edge (no match), keeps the
 * last candidates.
 *
 * @param {string} code    chunk code
 * @param {object} ref     `{ start, end }`
 * @param {object} modules RenderedChunk.modules (id → { code })
 * @returns {string[]} module ids (empty when none could be matched)
 */
function sourceModulesFor(code, ref, modules) {
  const entries = Object.entries(modules || {}).filter(([, m]) => m && m.code);

  let matches = [];

  for (const radius of [10, 40, 120, 400]) {
    const snippet = snippetAround(code, ref, radius);
    const found = entries.filter(([, m]) => m.code.includes(snippet)).map(([id]) => id);

    if (!found.length) break;
    matches = found;
    if (found.length === 1) break;
  }

  return matches;
}

/**
 * Human-readable report for a chunk with leaked CommonJS references.
 *
 * @param {string}   chunkName  e.g. `.clay/vite-kiln-edit-init-[hash].js`
 * @param {string}   code
 * @param {object[]} refs       from findFreeCommonjsRefs()
 * @param {object}   [opts]
 * @param {object}   [opts.modules]  RenderedChunk.modules, for source attribution
 * @param {string}   [opts.cwd]
 * @returns {string}
 */
function formatFreeCommonjsRefs(chunkName, code, refs, opts = {}) {
  const cwd = opts.cwd || process.cwd();
  const names = [...new Set(refs.map(r => r.name))].join(', ');
  const lines = refs.slice(0, MAX_REPORTED).map(ref => {
    const { line, column } = lineColumn(code, ref.start);
    const sources = sourceModulesFor(code, ref, opts.modules).map(id => displayModuleId(id, cwd));
    const from = sources.length ? ` in ${sources.slice(0, 3).join(', ')}` : '';
    const snippet = snippetAround(code, ref, 50).replace(/\s+/g, ' ').trim();

    return `  - \`${ref.name}\` at ${line}:${column}${from}\n      ${snippet}`;
  });

  if (refs.length > MAX_REPORTED) lines.push(`  … and ${refs.length - MAX_REPORTED} more`);

  return [
    `${chunkName} references CommonJS ${names} without defining it (${refs.length} place(s)).`,
    'Browsers have no such global, so this chunk throws "ReferenceError: … is not defined" when that code runs.',
    ...lines,
    'Usually @rollup/plugin-commonjs left part of that CommonJS module unconverted, or the module is in',
    'bundlerConfig().commonjsExclude. See CLAY-VITE.md § "CommonJS conversion in browser bundles".',
  ].join('\n');
}

/**
 * Vite plugin that fails the build when a rendered chunk references
 * `exports`, `module` or `require` without defining them.  See the doc block
 * at the top of this file.
 *
 * Runs in renderChunk with enforce:'post': after every other plugin has
 * shaped the chunk, but before Vite's own build plugins (import analysis and
 * the esbuild minify/transpile pass), which always run last.
 *
 * @param {object} [opts]
 * @param {string} [opts.cwd=process.cwd()]  base for module paths in errors
 * @returns {object} Vite plugin object
 */
function viteFreeCommonjsRefsPlugin(opts = {}) {
  const cwd = opts.cwd || process.cwd();

  return {
    name: 'clay-vite-free-cjs-refs',
    enforce: 'post',

    renderChunk(code, chunk) {
      let refs;

      try {
        refs = findFreeCommonjsRefs(code, input => this.parse(input));
      } catch (e) {
        // The checker must never be the reason a valid build fails.
        this.warn(`could not scan ${chunk.fileName} for CommonJS references: ${e.message}`);
        return null;
      }

      if (refs.length) {
        const chunkName = chunk.fileName.replace(/!~\{\w+\}~/g, '[hash]');

        this.error(formatFreeCommonjsRefs(chunkName, code, refs, { modules: chunk.modules, cwd }));
      }

      return null;
    },
  };
}

module.exports = viteFreeCommonjsRefsPlugin;
module.exports.findFreeCommonjsRefs = findFreeCommonjsRefs;
module.exports.formatFreeCommonjsRefs = formatFreeCommonjsRefs;

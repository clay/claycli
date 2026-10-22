'use strict';

// Flatten CSS nesting in Lightning CSS's AST, before it minifies.
//
// Lightning CSS compiles nesting while printing, after minification, so rules
// that come out of nesting are never merged with their neighbours; and a second
// pass over its own output isn't a no-op (it reorders some declarations again).
// Flattening in a visitor hands the minifier flat rules, the same input
// postcss-nested gave it, so the output matches what the PostCSS pipeline built.
//
// Rules come out the way postcss-nested wrote them: the parent's declarations,
// then each nested rule in order (declarations after a nested rule go in a copy
// of the parent), and an @media/@supports/@container inside a rule becomes an
// at-rule around a copy of the parent: its declarations first, then its rules.
// `&` is replaced by the parent selector, and a comma-list parent gives every
// combination. That is what the CSS nesting spec means too, except where `&`
// stands for a list whose selectors differ in specificity, holds a
// pseudo-element, or follows a combinator inside a complex selector: the spec
// reads `&` as `:is(<parent>)` there.

const { maskOpaque } = require('./styles-source');

const BUBBLE = new Set(['media', 'supports', 'container', 'layer-block', 'starting-style']);

// the fields where a component holds selectors: a list (`:is()`, `:not()`,
// `:has()`, `:where()`, `:nth-child(… of …)`) or a single one (`:host()`,
// `::slotted()`)
const SELECTOR_FIELDS = ['selectors', 'of', 'selector'];

const isSingleSelector = value => !value.length || !Array.isArray(value[0]);

function innerSelectors(component) {
  return SELECTOR_FIELDS.flatMap(key => {
    const value = component[key];

    if (!Array.isArray(value)) return [];

    return isSingleSelector(value) ? [value] : value;
  });
}

function hasNesting(components) {
  return components.some(c => c.type === 'nesting' || innerSelectors(c).some(hasNesting));
}

/**
 * Replace every `&` in a selector (also inside :not(), :is(), :has(),
 * :host(), :nth-child(… of …)) with the parent selector.
 *
 * @param {object[]} components
 * @param {object[]} parent
 * @returns {object[]}
 */
function replaceNesting(components, parent) {
  const out = [];

  for (const c of components) {
    if (c.type === 'nesting') {
      out.push(...parent);
      continue;
    }

    const copy = { ...c };

    for (const key of SELECTOR_FIELDS) {
      const value = c[key];

      if (!Array.isArray(value)) continue;
      copy[key] = isSingleSelector(value) ? replaceNesting(value, parent) : value.map(s => replaceNesting(s, parent));
    }
    out.push(copy);
  }

  return out;
}

/**
 * Lightning CSS prefixes `& ` to a nested selector whose only `&` is inside
 * `:nth-child(… of &)` (it doesn't see that one); the spec, and postcss-nested,
 * don't. Its tree is the same as for an `& ` the author wrote, so this is a
 * selector that may carry that prefix.
 *
 * @param {object[]} selector
 * @returns {boolean}
 */
function mayHaveImplicitNesting(selector) {
  const [first, second, ...rest] = selector;

  return !!(first && first.type === 'nesting' && second && second.type === 'combinator' && second.value === 'descendant' &&
    rest.some(c => Array.isArray(c.of) && c.of.some(hasNesting)));
}

/**
 * The code a stylesheet was parsed from, so the visitor can read a selector
 * as written. Masked lazily: it's needed only for mayHaveImplicitNesting().
 *
 * @param {string} code
 * @returns {object}
 */
function nestingSource(code) {
  return { code, masked: null, lineStarts: null };
}

/**
 * A nested rule's selectors as written, one string each, or null when they
 * can't be read back.
 *
 * @param {object} rule
 * @param {object} [source] - from nestingSource()
 * @returns {string[]|null}
 */
function writtenSelectors(rule, source) {
  const loc = rule.value.loc;

  if (!source || !loc) return null;
  if (!source.masked) {
    source.masked = maskOpaque(source.code);
    source.lineStarts = [0, ...[...source.code.matchAll(/\n/g)].map(m => m.index + 1)];
  }

  const start = source.lineStarts[loc.line] + loc.column - 1,
    end = source.masked.indexOf('{', start),
    texts = end === -1 ? [] : splitSelectorList(source.masked.slice(start, end));

  return texts.length === rule.value.selectors.length ? texts : null;
}

function splitSelectorList(text) {
  const parts = [];

  let depth = 0,
    from = 0;

  for (let i = 0; i < text.length; i++) {
    if ('(['.includes(text[i])) depth++;
    else if (')]'.includes(text[i])) depth--;
    else if (text[i] === ',' && !depth) {
      parts.push(text.slice(from, i));
      from = i + 1;
    }
  }

  return [...parts, text.slice(from)];
}

/**
 * Each child selector under each parent selector.
 *
 * @param {Array} parents
 * @param {Array} children
 * @param {function} [written] - () => the children as written (see writtenSelectors)
 * @returns {Array}
 */
function mergeSelectors(parents, children, written = () => null) {
  const merged = [],
    // drop Lightning CSS's own `& ` prefix, not one the author wrote
    own = children.map((child, i) => {
      if (!mayHaveImplicitNesting(child)) return child;

      const texts = written();

      return texts && /^\s*&/.test(texts[i]) ? child : child.slice(2);
    });

  for (const p of parents) {
    for (const c of own) {
      merged.push(hasNesting(c) ? replaceNesting(c, p) : [...p, { type: 'combinator', value: 'descendant' }, ...c]);
    }
  }

  return merged;
}

function styleRule(selectors, declarations, loc) {
  return { type: 'style', value: { selectors, declarations, rules: [], loc } };
}

function isEmpty(block) {
  return !block.declarations.length && !block.importantDeclarations.length;
}

/**
 * A style rule and everything nested in it, as flat rules.
 *
 * @param {object} rule - Lightning CSS style rule
 * @param {Array|null} parentSelectors
 * @param {object} [source] - from nestingSource()
 * @returns {object[]}
 */
function flattenStyle(rule, parentSelectors, source) {
  const v = rule.value,
    selectors = parentSelectors ? mergeSelectors(parentSelectors, v.selectors, () => writtenSelectors(rule, source)) : v.selectors;

  if (!v.rules || !v.rules.length) return [{ ...rule, value: { ...v, selectors } }];

  const out = isEmpty(v.declarations) ? [] : [styleRule(selectors, v.declarations, v.loc)];

  for (const child of v.rules) out.push(...flattenChild(child, selectors, source));

  return out;
}

/**
 * One rule nested in a style rule, flattened under its parent's selectors.
 *
 * @param {object} child
 * @param {Array} selectors - the parent's
 * @param {object} [source] - from nestingSource()
 * @returns {object[]}
 */
function flattenChild(child, selectors, source) {
  if (child.type === 'style') return flattenStyle(child, selectors, source);
  if (child.type === 'nested-declarations') return [styleRule(selectors, child.value.declarations, child.value.loc)];
  if (BUBBLE.has(child.type)) return [bubble(child, selectors, source)];

  return [child];
}

/**
 * An at-rule nested in a style rule: a copy of the parent with the at-rule's
 * declarations first, then its rules.
 *
 * @param {object} atRule
 * @param {Array} selectors - the parent's
 * @param {object} [source] - from nestingSource()
 * @returns {object}
 */
function bubble(atRule, selectors, source) {
  const block = { declarations: [], importantDeclarations: [] },
    rules = [];

  let loc;

  for (const child of atRule.value.rules) {
    if (child.type === 'nested-declarations') {
      block.declarations.push(...child.value.declarations.declarations);
      block.importantDeclarations.push(...child.value.declarations.importantDeclarations);
      loc = loc || child.value.loc;
    } else if (child.type === 'style') {
      rules.push(...flattenStyle(child, selectors, source));
    } else if (BUBBLE.has(child.type)) {
      rules.push(bubble(child, selectors, source));
    } else {
      rules.push(child);
    }
  }
  if (!isEmpty(block)) rules.unshift(styleRule(selectors, block, loc || atRule.value.loc));

  return { ...atRule, value: { ...atRule.value, rules } };
}

/**
 * Lightning CSS's visitor writes out values it can't always read back:
 *  - unset optional fields as null (`var()`'s `from`, `:nth-child()`'s `of`);
 *    a missing key reads as unset, so drop them
 *  - whole numbers outside -32768..32767 in float fields (`-99999px`,
 *    `aspect-ratio: 99999 / 1`) arrive as 64-bit integers it refuses ("expected
 *    a 32-bit floating point"); nudged by a hair they arrive as floats and round
 *    back to the same 32-bit float. Integer fields take them as they are: z-index
 *    (`type: 'integer'`), grid lines (`index`), `:nth-child()`'s An+B (`a`, `b`;
 *    matrix() and lab() use those names for floats), repeat() and steps() counts
 *    (`count`), source locations and integer properties like `order`.
 *
 * @param {object|object[]} node
 * @param {string} [key] - the node's key in its parent
 * @param {string} [property] - the declaration it is in
 * @param {boolean} [integer] - inside an integer field
 */
function prepare(node, key, property, integer = false) {
  if (Array.isArray(node)) {
    node.forEach((n, i) => {
      if (isWideInteger(n) && !integer) node[i] = nudge(n);
      else if (n && typeof n === 'object') prepare(n, key, property, integer);
    });
    return;
  }

  const prop = typeof node.property === 'string' ? node.property : property;

  Object.keys(node).forEach(k => {
    const value = node[k],
      // under an integer field (a repeat() or steps() count, …) everything is
      inner = integer || isIntegerField(node, k);

    if (value === null) delete node[k];
    else if (typeof value === 'object') prepare(value, k, prop, inner);
    else if (isWideInteger(value) && !inner && isFloatField(node, prop)) node[k] = nudge(value);
  });
}

const INTEGER_KEYS = new Set(['index', 'count', 'line', 'column', 'source_index']);

function isIntegerField(node, key) {
  return INTEGER_KEYS.has(key) || (key === 'a' || key === 'b') && /^nth-/.test(node.kind);
}
const INTEGER_PROPERTIES = new Set(['order', 'flex-order', 'box-ordinal-group', 'z-index', 'orphans', 'widows', 'column-count', 'hyphenate-limit-lines', 'initial-letter']);

function isFloatField(node, property) {
  return node.type !== 'integer' && !INTEGER_PROPERTIES.has(property);
}

function isWideInteger(value) {
  return typeof value === 'number' && Number.isInteger(value) && (value > 32767 || value < -32768);
}

function nudge(value) {
  return value + Math.sign(value) * Math.max(1e-6, Math.abs(value) * 1e-12);
}

/**
 * Flatten a style rule that holds nested rules.
 *
 * Only those rules are rebuilt: once a visitor returns a rule, Lightning CSS no
 * longer knows its selectors hold pseudo-elements, so it won't merge it with an
 * identical parsed rule, and it rewrites a selector list mixing vendor-prefixed
 * pseudo-elements (`::placeholder, ::-webkit-input-placeholder`) into :is(),
 * which browsers drop. Rules without nesting are left exactly as parsed.
 *
 * @param {object} rule - Lightning CSS style rule
 * @param {object} [source] - from nestingSource(), to read selectors as written
 * @returns {object[]|undefined}
 */
function flattenNesting(rule, source) {
  if (!rule.value.rules || !rule.value.rules.length) return undefined;

  const out = flattenStyle(rule, null, source);

  prepare(out);

  return out;
}

module.exports = { flattenNesting, nestingSource, mergeSelectors };

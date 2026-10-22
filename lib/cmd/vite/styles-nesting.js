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

const BUBBLE = new Set(['media', 'supports', 'container', 'layer-block', 'starting-style']);

function hasNesting(components) {
  return components.some(c => c.type === 'nesting' || Array.isArray(c.selectors) && c.selectors.some(hasNesting));
}

/**
 * Replace every `&` in a selector (also inside :not(), :is(), :has()...) with
 * the parent selector.
 *
 * @param {object[]} components
 * @param {object[]} parent
 * @returns {object[]}
 */
function replaceNesting(components, parent) {
  const out = [];

  for (const c of components) {
    if (c.type === 'nesting') out.push(...parent);
    else if (Array.isArray(c.selectors)) out.push({ ...c, selectors: c.selectors.map(s => replaceNesting(s, parent)) });
    else out.push(c);
  }

  return out;
}

function mergeSelectors(parents, children) {
  const merged = [];

  for (const p of parents) {
    for (const c of children) {
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
 * @returns {object[]}
 */
function flattenStyle(rule, parentSelectors) {
  const v = rule.value,
    selectors = parentSelectors ? mergeSelectors(parentSelectors, v.selectors) : v.selectors;

  if (!v.rules || !v.rules.length) return [{ ...rule, value: { ...v, selectors } }];

  const out = isEmpty(v.declarations) ? [] : [styleRule(selectors, v.declarations, v.loc)];

  for (const child of v.rules) out.push(...flattenChild(child, selectors));

  return out;
}

/**
 * One rule nested in a style rule, flattened under its parent's selectors.
 *
 * @param {object} child
 * @param {Array} selectors - the parent's
 * @returns {object[]}
 */
function flattenChild(child, selectors) {
  if (child.type === 'style') return flattenStyle(child, selectors);
  if (child.type === 'nested-declarations') return [styleRule(selectors, child.value.declarations, child.value.loc)];
  if (BUBBLE.has(child.type)) return [bubble(child, selectors)];

  return [child];
}

/**
 * An at-rule nested in a style rule: a copy of the parent with the at-rule's
 * declarations first, then its rules.
 *
 * @param {object} atRule
 * @param {Array} selectors - the parent's
 * @returns {object}
 */
function bubble(atRule, selectors) {
  const block = { declarations: [], importantDeclarations: [] },
    rules = [];

  let loc;

  for (const child of atRule.value.rules) {
    if (child.type === 'nested-declarations') {
      block.declarations.push(...child.value.declarations.declarations);
      block.importantDeclarations.push(...child.value.declarations.importantDeclarations);
      loc = loc || child.value.loc;
    } else if (child.type === 'style') {
      rules.push(...flattenStyle(child, selectors));
    } else if (BUBBLE.has(child.type)) {
      rules.push(bubble(child, selectors));
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
 *  - whole numbers outside -32768..32767 in float fields (`-99999px`) arrive as
 *    64-bit integers it refuses ("expected a 32-bit floating point"); nudged by
 *    a hair they arrive as floats and round back to the same 32-bit float.
 *    Integer fields (`{ type: 'integer' }`, e.g. z-index) take them as they are.
 *
 * @param {object|object[]} node
 */
function prepare(node) {
  if (Array.isArray(node)) {
    node.forEach(n => { if (n && typeof n === 'object') prepare(n); });
    return;
  }
  Object.keys(node).forEach(key => {
    const value = node[key];

    if (value === null) delete node[key];
    else if (typeof value === 'object') prepare(value);
    else if (isWideInteger(value) && node.type !== 'integer') node[key] = nudge(value);
  });
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
 * @returns {object[]|undefined}
 */
function flattenNesting(rule) {
  if (!rule.value.rules || !rule.value.rules.length) return undefined;

  const out = flattenStyle(rule, null);

  prepare(out);

  return out;
}

module.exports = { flattenNesting, mergeSelectors };

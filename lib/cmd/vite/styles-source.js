'use strict';

// Reading styleguide CSS for the Lightning CSS pipeline: @import inlining,
// design tokens, and a small scanner for finding statements in the text.

const path = require('path');
const fs = require('fs-extra');

// comments and strings, which the scanner and the token inliner step over
const OPAQUE = /\/\*[\s\S]*?\*\/|"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'/g;

/**
 * Call `fn` on the parts of `code` outside comments and strings and join the
 * results back up.
 *
 * @param {string}   code
 * @param {function} fn - (text) => text
 * @returns {string}
 */
function mapOutsideOpaque(code, fn) {
  let out = '',
    last = 0,
    match;

  OPAQUE.lastIndex = 0;
  while (match = OPAQUE.exec(code)) {
    out += `${fn(code.slice(last, match.index))}${match[0]}`;
    last = match.index + match[0].length;
  }

  return out + fn(code.slice(last));
}

/**
 * Blank out comments and strings, keeping every character's position, so
 * delimiters inside them don't count.
 *
 * @param {string} code
 * @returns {string}
 */
function maskOpaque(code) {
  return code.replace(OPAQUE, m => m.replace(/[^\n]/g, ' '));
}

/**
 * The @import statements at the top of a stylesheet (the only place CSS
 * allows them), with their positions.
 *
 * @param {string} code
 * @returns {{start: number, end: number, url: string, conditions: string}[]}
 */
function leadingImports(code) {
  const masked = maskOpaque(code),
    imports = [];

  let pos = 0;

  for (;;) {
    while (pos < masked.length && /\s/.test(masked[pos])) pos++;
    if (!/^@(import|charset|layer)\b/i.test(masked.slice(pos, pos + 8))) return imports;

    const end = masked.indexOf(';', pos);

    if (end === -1) return imports;
    if (/^@import\b/i.test(masked.slice(pos, pos + 7))) {
      const statement = code.slice(pos + 7, end).trim(),
        match = statement.match(/^(?:url\(\s*)?(['"]?)([^'")\s]+)\1\s*\)?\s*(.*)$/s);

      if (match) imports.push({ start: pos, end: end + 1, url: match[2], conditions: match[3].trim() });
    }
    pos = end + 1;
  }
}

/**
 * Find a stylesheet an @import points at the way postcss-import did: next to
 * the importing file, then in each import path, with `.css` optional, then as
 * a package file.
 *
 * @param {string}   url
 * @param {string}   from - importing file
 * @param {string[]} importPaths - absolute
 * @returns {string}
 */
function resolveImport(url, from, importPaths) {
  for (const base of [path.dirname(from), ...importPaths]) {
    for (const candidate of [path.resolve(base, url), path.resolve(base, `${url}.css`)]) {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
    }
  }
  try {
    return require.resolve(url, { paths: [path.dirname(from)] });
  } catch (e) {
    throw new Error(`${from}: can't find @import '${url}'`);
  }
}

/**
 * Inline a stylesheet's @imports, depth first; a file already inlined is skipped
 * (the first @import wins, as with postcss-import). Each part keeps its file so
 * output lines can be traced back.
 *
 * @param {string}   file
 * @param {object}   options
 * @param {string[]} options.importPaths - absolute
 * @param {function} options.read - (file) => text
 * @param {Set}      [seen]
 * @returns {{file: string, text: string}[]}
 */
function inlineImports(file, options, seen = new Set()) {
  const text = options.read(file),
    parts = [];

  let own = text;

  seen.add(file);
  for (const imp of leadingImports(text)) {
    if (imp.conditions) {
      throw new Error(`${file}: @import with conditions (${imp.conditions}) isn't supported; wrap the imported rules in the condition instead`);
    }

    const target = resolveImport(imp.url, file, options.importPaths);

    if (!seen.has(target)) parts.push(...inlineImports(target, options, seen));
    // blank the statement but keep its lines, so line numbers still match the file
    own = own.slice(0, imp.start) + own.slice(imp.start, imp.end).replace(/[^\n]/g, ' ') + own.slice(imp.end);
  }
  parts.push({ file, text: own });

  return parts;
}

/**
 * Turn a DTCG token value into CSS text.
 *
 * @param {*}      value
 * @param {string} name - for errors
 * @returns {string}
 */
function tokenValueToCss(value, name) {
  const write = TOKEN_VALUES.find(([test]) => test(value));

  if (!write) throw new Error(`design token ${name}: unsupported $value ${JSON.stringify(value)}`);

  return write[1](value);
}

const isObject = value => !!value && typeof value === 'object';
// [test, write] for each kind of DTCG $value
const TOKEN_VALUES = [
  [value => typeof value === 'string' || typeof value === 'number', String],
  // fontFamily: quote names that aren't plain identifiers
  [Array.isArray, families => families.map(f => /^[a-z][\w-]*$/i.test(f) || /^\{.*\}$/.test(f) ? f : `'${f}'`).join(', ')],
  // dimension / duration
  [value => isObject(value) && 'value' in value && 'unit' in value, value => `${value.value}${value.unit}`],
  // color objects (DTCG 2025.10) carry a hex fallback
  [value => isObject(value) && typeof value.hex === 'string', value => value.hex],
];

/**
 * Read design tokens (W3C Design Tokens / DTCG JSON) into CSS custom property
 * names and values: `{ "color": { "black": { "$value": "#000" } } }` is
 * `--color-black: #000`. `{color.black}` references are resolved.
 *
 * @param {string[]} files - absolute paths; later files win
 * @returns {Map<string, string>}
 */
function loadTokens(files) {
  const raw = new Map();

  for (const file of files) {
    (function walk(node, prefix) {
      for (const [key, value] of Object.entries(node)) {
        if (key.startsWith('$') || !value || typeof value !== 'object') continue;
        if ('$value' in value) raw.set(`--${[...prefix, key].join('-')}`, tokenValueToCss(value.$value, [...prefix, key].join('.')));
        else walk(value, [...prefix, key]);
      }
    }(JSON.parse(fs.readFileSync(file, 'utf8')), []));
  }

  const tokens = new Map();

  function resolve(name, stack = []) {
    if (tokens.has(name)) return tokens.get(name);
    if (stack.includes(name)) throw new Error(`design tokens: circular reference ${[...stack, name].join(' → ')}`);
    if (!raw.has(name)) throw new Error(`design tokens: ${stack[stack.length - 1]} refers to missing ${name}`);

    const value = raw.get(name).replace(/\{([^}]+)\}/g, (m, ref) => resolve(`--${ref.replace(/\./g, '-')}`, [...stack, name]));

    tokens.set(name, value);

    return value;
  }

  for (const name of raw.keys()) resolve(name);

  return tokens;
}

/**
 * Inline design tokens: `var(--token)` (with no fallback) becomes the token's
 * value. Done on the text rather than in a Lightning CSS visitor: its Variable
 * visitor loses the whitespace after a replaced var(), so `var(--a) 0` would
 * print as `#0000`.
 *
 * @param {string}              code
 * @param {Map<string, string>} tokens
 * @returns {string}
 */
function inlineTokens(code, tokens) {
  if (!tokens.size || !code.includes('var(')) return code;

  return mapOutsideOpaque(code, text => text.replace(/var\(\s*(--[\w-]+)\s*\)/g, (m, name) => tokens.has(name) ? tokens.get(name) : m));
}

/**
 * The extent of the declaration around a position, if the position is in one:
 * from after the previous `;`, `{` or `}` to its `;` (or the `}` closing the
 * block). Null when that stretch is a selector or at-rule prelude.
 *
 * @param {string} code
 * @param {number} offset
 * @returns {{start: number, end: number}|null}
 */
function declarationAt(code, offset) {
  const masked = maskOpaque(code),
    start = scan(masked, offset, -1),
    end = scan(masked, offset, 1);

  if (masked[end] === '{' || !/^\s*-{0,2}[a-z][\w-]*\s*:/i.test(masked.slice(start, end))) return null;

  return { start, end: masked[end] === ';' ? end + 1 : end };
}

/**
 * Walk from an offset to the nearest `;`, `{` or `}` outside parentheses, back
 * (step -1: returns the position after it) or forward (step 1: its position).
 *
 * @param {string} masked - code from maskOpaque()
 * @param {number} offset
 * @param {number} step - -1 or 1
 * @returns {number}
 */
function scan(masked, offset, step) {
  const back = step < 0,
    end = back ? 0 : masked.length,
    depthChange = back ? DEPTH_BACK : DEPTH_FORWARD;

  let pos = offset,
    depth = 0;

  for (; pos !== end; pos += step) {
    const ch = masked[back ? pos - 1 : pos];

    if (depth === 0 && ';{}'.includes(ch)) break;
    depth = Math.max(depth + (depthChange[ch] || 0), 0);
  }

  return pos;
}

const DEPTH_FORWARD = { '(': 1, '[': 1, ')': -1, ']': -1 };
const DEPTH_BACK = { ')': 1, ']': 1, '(': -1, '[': -1 };

/**
 * PostCSS-only syntax the Lightning CSS pipeline can't read, if any.
 *
 * @param {string} code
 * @returns {string|null} what was found
 */
function findPostcssSyntax(code) {
  const masked = maskOpaque(code),
    match = masked.match(/@(define-)?mixin\b|(?:^|[;{}\s])\$[\w-]+\s*:/m);

  return match ? match[0].trim() : null;
}

module.exports = {
  inlineImports,
  leadingImports,
  loadTokens,
  inlineTokens,
  declarationAt,
  findPostcssSyntax,
  maskOpaque,
};

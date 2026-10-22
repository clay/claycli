'use strict';

// Reading styleguide CSS for the Lightning CSS pipeline: @import inlining,
// design tokens, asset-host placeholders, and a small scanner for finding
// statements in the text.

const path = require('path');
const fs = require('fs-extra');

// comments, strings, unquoted url()s and escapes (`.a\{`, `\'`), which the
// scanner and the token inliner step over (an escaped newline, LF or CRLF,
// can continue a string)
const OPAQUE = /\/\*[\s\S]*?\*\/|"(?:[^"\\\n]|\\(?:\r\n|[\s\S]))*"|'(?:[^'\\\n]|\\(?:\r\n|[\s\S]))*'|\burl\(\s*[^\s'")](?:[^)\\]|\\[\s\S])*\)|\\[\s\S]/gi;
const COMMENT = /\/\*[\s\S]*?\*\//g;
// an @import of another site's stylesheet stays an @import
const REMOTE = /^([a-z][a-z\d+.-]*:|\/\/)/i;

/**
 * Call `fn` on the parts of `code` outside comments, strings and url()s, and
 * join the results back up.
 *
 * @param {string}   code
 * @param {function} fn - (text) => text
 * @param {RegExp}   [skip] - what to step over (global); OPAQUE by default
 * @returns {string}
 */
function mapOutside(code, fn, skip = OPAQUE) {
  let out = '',
    last = 0,
    match;

  skip.lastIndex = 0;
  while (match = skip.exec(code)) {
    out += `${fn(code.slice(last, match.index))}${match[0]}`;
    last = match.index + match[0].length;
  }

  return out + fn(code.slice(last));
}

/**
 * Blank out comments, strings and url()s, keeping every character's
 * position, so delimiters inside them don't count.
 *
 * @param {string} code
 * @returns {string}
 */
function maskOpaque(code) {
  return code.replace(OPAQUE, m => m.replace(/[^\n]/g, ' '));
}

/**
 * The @import statements at the top of a stylesheet (the only place CSS
 * allows them), with their positions. The last statement of a file needs no
 * `;`.
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

    const semicolon = masked.indexOf(';', pos),
      end = semicolon === -1 ? masked.length : semicolon;

    if (/^@import\b/i.test(masked.slice(pos, pos + 7))) {
      const statement = code.slice(pos + 7, end).trim(),
        match = statement.match(/^(?:url\(\s*)?(['"]?)([^'")\s]+)\1\s*\)?\s*(.*)$/s);

      if (match) imports.push({ start: pos, end: Math.min(end + 1, code.length), url: match[2], conditions: match[3].trim() });
    }
    pos = end + 1;
  }
}

/**
 * The @charset and @layer statements (`@layer a, b;`, not blocks) before the
 * first rule.
 *
 * @param {string} code
 * @returns {{start: number, end: number}[]}
 */
function leadingStatements(code) {
  const masked = maskOpaque(code),
    found = [];

  let imported = false;

  for (let statement = nextStatement(masked, 0); statement; statement = nextStatement(masked, statement.end)) {
    // an @layer statement after an @import comes after what it imports
    if (statement.isImport) imported = true;
    else if (!imported) found.push({ start: statement.start, end: statement.end });
  }

  return found;
}

/**
 * The @import, @charset or @layer statement starting at the first non-space
 * character from `pos`, if there is one.
 *
 * @param {string} masked - maskOpaque() text
 * @param {number} pos
 * @returns {{start: number, end: number, isImport: boolean}|null}
 */
function nextStatement(masked, pos) {
  const start = pos + masked.slice(pos).search(/\S|$/),
    keyword = /^@(import|charset|layer)\b/i.exec(masked.slice(start, start + 8)),
    semicolon = masked.indexOf(';', start),
    brace = masked.indexOf('{', start);

  if (!keyword || semicolon === -1 || brace !== -1 && brace < semicolon) return null;

  return { start, end: semicolon + 1, isImport: keyword[1].toLowerCase() === 'import' };
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
 * 1-based line of an offset.
 *
 * @param {string} text
 * @param {number} offset
 * @returns {number}
 */
function lineAt(text, offset) {
  return text.slice(0, offset).split('\n').length;
}

const PAIRS = { '{': '}', '(': ')', '[': ']' };
const CLOSERS = { '}': true, ')': true, ']': true };

/**
 * Throw for an unclosed comment, string, block or bracket, or a stray closer. Files are
 * joined into one stylesheet, where one of these would swallow or restructure
 * the files after it instead of failing.
 *
 * @param {string} text
 * @param {string} file
 */
function checkBalanced(text, file) {
  const masked = maskOpaque(text),
    fail = (offset, what) => { throw new Error(`${file}:${lineAt(text, offset)}: ${what}`); };

  if (masked.includes('/*')) fail(masked.indexOf('/*'), 'unclosed comment');

  const quote = masked.search(/["']/);

  if (quote !== -1) fail(quote, 'unclosed string');

  const problem = findUnbalanced(masked);

  if (problem) fail(problem.offset, problem.what);
}

/**
 * The first stray closer or, failing that, the first unclosed bracket.
 *
 * @param {string} masked - maskOpaque() text
 * @returns {{offset: number, what: string}|null}
 */
function findUnbalanced(masked) {
  const open = [];

  for (let i = 0; i < masked.length; i++) {
    const ch = masked[i];

    if (PAIRS[ch]) open.push(i);
    else if (CLOSERS[ch] && PAIRS[masked[open.pop()]] !== ch) return { offset: i, what: `unexpected \`${ch}\`` };
  }

  return open.length ? { offset: open[0], what: `unclosed \`${masked[open[0]]}\`` } : null;
}

/**
 * Inline a stylesheet's @imports, depth first; a file already inlined is skipped
 * (the first @import wins, as with postcss-import). Each part keeps its file so
 * output lines can be traced back. @imports of other sites' stylesheets
 * (`https://…`, `//…`) stay @imports, gathered in a first part.
 *
 * @param {string}   file
 * @param {object}   options
 * @param {string[]} options.importPaths - absolute
 * @param {function} options.read - (file) => text
 * @returns {{file: string, text: string}[]}
 */
function inlineImports(file, options) {
  const remote = [],
    leading = [],
    parts = collect(file, { ...options, remote, leading }, new Set()),
    first = [...leading, ...remote];

  return first.length ? [{ file, text: first.join('\n') }, ...parts] : parts;
}

function collect(file, options, seen) {
  const text = options.read(file).replace(/^﻿/, ''),
    parts = [];

  let own = text;

  checkBalanced(text, file);
  // the entry's own leading @charset / @layer statements go first, before
  // anything inlined (layer order is the order layers first appear)
  if (!seen.size) {
    for (const st of leadingStatements(text)) {
      options.leading.push(text.slice(st.start, st.end).trim());
      own = own.slice(0, st.start) + own.slice(st.start, st.end).replace(/[^\n]/g, ' ') + own.slice(st.end);
    }
  }
  seen.add(file);
  for (const imp of leadingImports(text)) {
    if (REMOTE.test(imp.url)) {
      options.remote.push(text.slice(imp.start, imp.end).trim().replace(/;?$/, ';'));
    } else if (imp.conditions) {
      throw new Error(`${file}: @import with conditions (${imp.conditions}) isn't supported; wrap the imported rules in the condition instead`);
    } else {
      const target = resolveImport(imp.url, file, options.importPaths);

      if (!seen.has(target)) parts.push(...collect(target, options, seen));
    }
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
 * @param {string} type - the token's $type (its own or its group's)
 * @param {string} name - for errors
 * @returns {string}
 */
function tokenValueToCss(value, type, name) {
  const write = TOKEN_VALUES.find(([test]) => test(value, type));

  if (!write) throw new Error(`design token ${name}: unsupported $value ${JSON.stringify(value)}${type ? ` for $type ${type}` : ''}`);

  return write[1](value);
}

const isObject = value => !!value && typeof value === 'object';
// [test, write] for each kind of DTCG $value
const TOKEN_VALUES = [
  [value => typeof value === 'string' || typeof value === 'number', String],
  // fontFamily: quote names that aren't plain identifiers
  [(value, type) => Array.isArray(value) && (type === 'fontFamily' || !type) && value.every(v => typeof v === 'string'),
    families => families.map(f => /^[a-z][\w-]*$/i.test(f) || /^\{.*\}$/.test(f) ? f : `'${f.replace(/[\\']/g, '\\$&')}'`).join(', ')],
  [(value, type) => Array.isArray(value) && type === 'cubicBezier' && value.length === 4, value => `cubic-bezier(${value.join(', ')})`],
  // dimension / duration
  [value => isObject(value) && 'value' in value && 'unit' in value, value => `${value.value}${value.unit}`],
  // color objects (DTCG 2025.10) carry a hex fallback
  [value => isObject(value) && typeof value.hex === 'string', value => value.hex],
];

/**
 * Read design tokens (W3C Design Tokens / DTCG JSON) into CSS custom property
 * names and values: `{ "color": { "black": { "$value": "#000" } } }` is
 * `--color-black: #000`. `{color.black}` references are resolved; `$type` is
 * inherited from groups.
 *
 * @param {string[]} files - absolute paths; later files win
 * @returns {Map<string, string>}
 */
function loadTokens(files) {
  const raw = new Map();

  for (const file of files) {
    (function walk(node, prefix, groupType) {
      const type = node.$type || groupType;

      for (const [key, value] of Object.entries(node)) {
        if (key.startsWith('$') || !isObject(value)) continue;
        if ('$value' in value) {
          raw.set(`--${[...prefix, key].join('-')}`, tokenValueToCss(value.$value, value.$type || type, [...prefix, key].join('.')));
        } else {
          walk(value, [...prefix, key], type);
        }
      }
    }(JSON.parse(fs.readFileSync(file, 'utf8')), [], undefined));
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

  return mapOutside(code, text => text.replace(/var\(\s*(--[\w-]+)\s*\)/g, (m, name) => tokens.has(name) ? tokens.get(name) : m));
}

/**
 * Edit distance between two strings, a swap of two neighbouring characters
 * counting as one edit; more than `max` when the lengths differ by more.
 *
 * @param {string} a
 * @param {string} b
 * @param {number} max
 * @returns {number}
 */
function distance(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;

  const d = Array.from({ length: a.length + 1 }, (v, i) => [i]),
    // edits from a's first i characters to b's first j
    editsTo = (i, j) => {
      const edits = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)),
        swapped = i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1];

      return swapped ? Math.min(edits, d[i - 2][j - 2] + 1) : edits;
    };

  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) d[i][j] = editsTo(i, j);
  }

  return d[a.length][b.length];
}

/**
 * `var(--name)`s (with no fallback) that look like a misspelled design token:
 * not a token, not set (or registered with @property) in the code, in a token's
 * group (`--color-…`) and within one edit of it (two for long names). They'd be undefined at run time, where a misspelled `$variable` used
 * to fail the build.
 *
 * @param {string}              code - after inlineTokens()
 * @param {Map<string, string>} tokens
 * @returns {{offset: number, name: string, suggestion: string}[]}
 */
function findUnknownTokens(code, tokens) {
  if (!tokens.size || !code.includes('var(')) return [];

  const masked = maskOpaque(code),
    declared = new Set([...masked.matchAll(/(?:@property\s+)?(--[\w-]+)\s*[:{]/g)].map(m => m[1])),
    names = [...tokens.keys()],
    group = name => name.split('-')[2],
    found = [];

  for (const m of masked.matchAll(/var\(\s*(--[\w-]+)\s*\)/g)) {
    const name = m[1],
      // one edit for short names, two for long ones
      max = name.length >= 14 ? 2 : 1;

    if (tokens.has(name) || declared.has(name)) continue;

    const suggestion = names.find(token => group(token) === group(name) && distance(name, token, max) <= max);

    if (suggestion) found.push({ offset: m.index, name, suggestion });
  }

  return found;
}

const PLACEHOLDER = /\$(?:\((asset-host|asset-path)\)|(asset-host|asset-path)(?![\w-]))/g;

/**
 * Fill `$asset-host` / `$asset-path` placeholders (also written `$(asset-host)`)
 * anywhere but in comments: url()s, image-set() strings.
 *
 * @param {string} code
 * @param {object} values - { 'asset-host': …, 'asset-path': … }
 * @returns {string}
 */
function fillPlaceholders(code, values) {
  if (!code.includes('$')) return code;

  return mapOutside(code, text => text.replace(PLACEHOLDER, (m, wrapped, bare) => values[wrapped || bare] || ''), COMMENT);
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

  if (masked[end] === '{' || !/^\s*[*_]?-{0,2}[a-z][\w-]*\s*:/i.test(masked.slice(start, end))) return null;

  // from its first character, past any comment before it
  return { start: start + masked.slice(start).search(/\S/), end: masked[end] === ';' ? end + 1 : end };
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
 * PostCSS-only syntax the Lightning CSS pipeline can't read, if any:
 * `$variable` definitions and uses (other than the `$asset-host` / `$asset-path`
 * placeholders), mixins, `@at-root`, `&-suffix`.
 *
 * @param {string} code
 * @returns {string|null} what was found
 */
function findPostcssSyntax(code) {
  const masked = maskOpaque(code),
    match = masked.match(/@(define-)?mixin\b|@at-root\b|@nest\b|(?:^|[;{}\s])\$[\w-]+\s*:|(?<![\w-])\$(?!\(?asset-(?:host|path)(?![\w-]))\(?[a-z_][\w-]*|&[\w-]+/im);

  return match ? match[0].trim() : null;
}

module.exports = {
  inlineImports,
  leadingImports,
  loadTokens,
  inlineTokens,
  findUnknownTokens,
  fillPlaceholders,
  declarationAt,
  findPostcssSyntax,
  maskOpaque,
};

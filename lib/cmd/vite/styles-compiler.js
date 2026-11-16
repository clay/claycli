'use strict';

const path = require('path');
const fs = require('fs-extra');
const postcss = require('postcss');

/**
 * Resolve the styles step's config: the legacy top-level `postcssImportPaths`
 * and `autoprefixerOptions` keys first, then the `stylesConfig` hook, which
 * mutates the object in place.
 *
 * Runs on the main thread and again inside every worker, because the hook can
 * add PostCSS plugin instances that cannot be sent to a worker thread.
 *
 * @param {function} getValue - reads a key from claycli.config.js
 * @param {object}   [options]
 * @param {boolean}  [options.minify]
 * @returns {object}
 */
function resolveStylesConfig(getValue, options = {}) {
  const config = {
    importPaths: getValue('postcssImportPaths') || ['./styleguides'],
    autoprefixerOptions: getValue('autoprefixerOptions') || {},
    browserslist: undefined,
    plugins: [],
    lightningcssOptions: {},
    minify: options.minify || !!process.env.CLAYCLI_COMPILE_MINIFIED || false,
  };
  const hook = getValue('stylesConfig');

  if (typeof hook === 'function') hook(config);

  return config;
}

// Used when neither the hook nor the project names a browserslist.  A fixed Baseline
// date, not browserslist's defaults: those follow usage data, so the CSS Lightning CSS
// prints would change whenever browserslist's data does.  Move it on purpose, in a release.
const FALLBACK_BROWSERS = 'baseline widely available on 2025-05-01';

/**
 * The browsers Lightning CSS targets: `browserslist` from the hook, else the
 * project's own browserslist config (.browserslistrc, package.json, or the
 * BROWSERSLIST env var), else FALLBACK_BROWSERS.
 *
 * Lightning CSS treats these as the oldest browsers to support: once all of
 * them support newer syntax it prints that syntax (range media queries,
 * `inset`) and drops fallbacks.  So this is a floor, not a usage share — a
 * query like `> 2%` would break every browser below it.
 *
 * @param {object} config
 * @param {string} root - project root, where browserslist looks for config
 * @returns {string[]}
 */
function getTargetBrowsers(config, root) {
  const browserslist = require('browserslist');
  const options = { path: root };
  const queries = config.browserslist ?? browserslist.loadConfig(options) ?? FALLBACK_BROWSERS;

  return browserslist(queries, options);
}

/**
 * Lightning CSS targets for the config.  Computed once on the main thread and
 * handed to workers, so browserslist's "data is old" notice prints once.
 *
 * @param {object} config
 * @param {string} root
 * @returns {object}
 */
function resolveTargets(config, root) {
  const { browserslistToTargets } = require('lightningcss');

  return browserslistToTargets(getTargetBrowsers(config, root));
}

/**
 * Move a 1-based line/column past a chunk of printed CSS.
 *
 * @param {{line: number, column: number}} pos
 * @param {string} part
 * @returns {{line: number, column: number}}
 */
function advance(pos, part) {
  const lines = part.split('\n');

  if (lines.length === 1) return { line: pos.line, column: pos.column + part.length };

  return { line: pos.line + lines.length - 1, column: lines[lines.length - 1].length + 1 };
}

/**
 * Whether a line/column falls in [start, end).
 *
 * @param {{line: number, column: number}} loc
 * @param {{line: number, column: number}} start
 * @param {{line: number, column: number}} end
 * @returns {boolean}
 */
function isWithin(loc, start, end) {
  const afterStart = loc.line > start.line || loc.line === start.line && loc.column >= start.column;
  const beforeEnd = loc.line < end.line || loc.line === end.line && loc.column < end.column;

  return afterStart && beforeEnd;
}

/**
 * Find the node whose printed text contains a 1-based line/column of the CSS
 * PostCSS prints for `root` (the code Lightning CSS saw).  A declaration covers
 * its whole text; a rule or at-rule only its prelude up to `{`.
 *
 * @param {object} root - PostCSS root
 * @param {{line: number, column: number}} loc
 * @returns {object|null} PostCSS node
 */
function findNodeAt(root, loc) {
  let pos = { line: 1, column: 1 },
    found = null;

  postcss.stringify(root, (part, node) => {
    const start = pos;

    pos = advance(pos, part);
    if (!found && node && node.type !== 'root' && isWithin(loc, start, pos)) found = node;
  });

  return found;
}

/**
 * Describe a Lightning CSS diagnostic at the source position PostCSS recorded
 * for the node it points at (the file the author edits, after @import, mixins
 * and nesting), falling back to the entry file.
 *
 * @param {object} diagnostic - Lightning CSS warning or error ({ message, loc })
 * @param {object|null} node
 * @param {string[]} roots - the project root, and its real path when that
 *                           differs (postcss-import reports imports by real path)
 * @param {string} srcPath
 * @returns {{file: string, line: number, column: number, message: string}}
 */
function describe(diagnostic, node, roots, srcPath) {
  const source = node && node.source || {},
    start = source.start || { line: 0, column: 0 },
    file = source.input && source.input.file || srcPath,
    relative = roots.map(dir => path.relative(dir, file)).find(rel => !rel.startsWith('..'));

  return {
    file: relative === undefined ? file : relative,
    line: start.line,
    column: start.column,
    message: diagnostic.message + declarationNote(node),
  };
}

/**
 * Quote the declaration a diagnostic points at, if any.
 *
 * @param {object|null} node
 * @returns {string}
 */
function declarationNote(node) {
  if (!node || node.type !== 'decl') return '';

  const value = node.value.length > 60 ? `${node.value.slice(0, 57)}...` : node.value;

  return ` in \`${node.prop}: ${value}\``;
}

// Lightning CSS prints a rule's `font` shorthand after every other declaration in the rule, so a
// property that came after `font` in the source ends up before it.  `font` resets these properties
// (or, for font-stretch, cannot carry a percentage), so the later value would be lost.  A `font`
// that has one of them after it is held as a custom property, which Lightning CSS leaves where it is.
const FONT_RESET_PROPS = new Set([
  'font-variation-settings', 'font-feature-settings', 'font-kerning', 'font-optical-sizing',
  'font-size-adjust', 'font-language-override', 'font-stretch',
  'font-variant-ligatures', 'font-variant-numeric', 'font-variant-east-asian', 'font-variant-alternates',
  'font-variant-position', 'font-variant-emoji',
]);
const HELD_FONT = '--claycli-font';

/**
 * Hold the `font` shorthands that Lightning CSS would move behind a property they reset.
 *
 * @param {object} root - PostCSS root, changed in place
 */
function holdFontShorthands(root) {
  root.walkRules(rule => {
    const fonts = [];

    rule.each(node => {
      if (node.type !== 'decl') return;

      const prop = node.prop.toLowerCase();

      if (prop === 'font') fonts.push(node);
      else if (FONT_RESET_PROPS.has(prop)) {
        fonts.splice(0).forEach(font => {
          font.prop = HELD_FONT;
        });
      }
    });
  });
}

/**
 * Print the held `font` shorthands as `font` again.
 *
 * @param {Buffer} code - Lightning CSS output
 * @returns {Buffer}
 */
function releaseFontShorthands(code) {
  const css = code.toString();

  return css.includes(HELD_FONT) ? Buffer.from(css.replace(new RegExp(`${HELD_FONT}(?=\\s*:)`, 'g'), 'font')) : code;
}

/**
 * Build a compiler for one config: PostCSS (postcss-import, postcss-mixins,
 * postcss-simple-vars, postcss-nested, then the hook's `plugins`) followed by
 * Lightning CSS for vendor prefixes and, when minifying, minification.
 *
 * Paths resolve from `root`; nothing here reads process.cwd(), so the same
 * compiler runs on the main thread and in worker threads.
 *
 * @param {object} params
 * @param {string} params.root      - project root
 * @param {object} params.config    - from resolveStylesConfig()
 * @param {object} params.variables - postcss-simple-vars globals
 * @param {object} params.targets   - from resolveTargets()
 * @returns {{compile: function(string, string): Promise<{errors: object[]}>}}
 */
function createCompiler({ root, config, variables, targets }) {
  const { transform } = require('lightningcss');
  const processor = postcss([
    require('postcss-import')({ path: config.importPaths, root }),
    require('postcss-mixins')(),
    // simple-vars before nested so variables resolve before nesting is parsed
    require('postcss-simple-vars')({ variables }),
    require('postcss-nested')(),
    ...config.plugins || [],
  ]);
  const roots = [...new Set([root, fs.realpathSync(root)])];

  function lightning(ast, srcPath) {
    try {
      holdFontShorthands(ast);

      const result = transform({
        minify: !!config.minify,
        targets,
        errorRecovery: true,
        ...config.lightningcssOptions,
        filename: path.relative(root, srcPath),
        code: Buffer.from(ast.toString()),
      });

      result.code = releaseFontShorthands(result.code);

      return result;
    } catch (err) {
      if (err.loc) {
        const where = describe(err, findNodeAt(ast, err.loc), roots, srcPath);

        err.message = `${where.file}:${where.line}:${where.column}: ${err.message}`;
      }
      throw err;
    }
  }

  /**
   * Compile one file.  CSS that Lightning CSS cannot parse is returned as
   * `errors` (at the source file and line PostCSS recorded) next to the output
   * it recovered, which can be missing more than the bad declaration.
   *
   * @param {string} srcPath
   * @param {string} destPath
   * @returns {Promise<{errors: object[]}>}
   */
  async function compile(srcPath, destPath) {
    const source = await fs.readFile(srcPath, 'utf8'),
      { root: ast } = await processor.process(source, { from: srcPath, to: destPath, map: false }),
      result = lightning(ast, srcPath),
      errors = result.warnings.map(warning => {
        return describe(warning, warning.loc ? findNodeAt(ast, warning.loc) : null, roots, srcPath);
      });

    await fs.ensureDir(path.dirname(destPath));
    await fs.writeFile(destPath, result.code);

    return { errors };
  }

  return { compile };
}

module.exports = {
  resolveStylesConfig,
  getTargetBrowsers,
  resolveTargets,
  createCompiler,
  findNodeAt,
};

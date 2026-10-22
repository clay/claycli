'use strict';

const path = require('path');
const fs = require('fs-extra');
const source = require('./styles-source');
const { flattenNesting } = require('./styles-nesting');

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
    // 'lightningcss': standard CSS (nesting, design tokens), Lightning CSS only.
    // 'postcss': the PostCSS syntax ($variables, mixins, `&-suffix`), deprecated.
    pipeline: 'lightningcss',
    importPaths: getValue('postcssImportPaths') || ['./styleguides'],
    // design token files (DTCG JSON), relative to the project root; by default
    // styleguides/_default/tokens.json when it exists
    tokens: undefined,
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

/**
 * The browsers Lightning CSS targets: `browserslist` from the hook, else the
 * project's own browserslist config (.browserslistrc, package.json, or
 * browserslist's defaults).
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
  return require('browserslist')(config.browserslist, { path: root });
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

  require('postcss').stringify(root, (part, node) => {
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
function createPostcssCompiler({ root, config, variables, targets }) {
  const { transform } = require('lightningcss');
  const processor = require('postcss')([
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
      return transform({
        minify: !!config.minify,
        targets,
        errorRecovery: true,
        ...config.lightningcssOptions,
        filename: path.relative(root, srcPath),
        code: Buffer.from(ast.toString()),
      });
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

/**
 * The design token files for the config, as absolute paths.
 *
 * @param {object} config
 * @param {string} root
 * @returns {string[]}
 */
function getTokenFiles(config, root) {
  if (config.tokens) return [].concat(config.tokens).map(file => path.resolve(root, file));

  const fallback = path.join(root, 'styleguides', '_default', 'tokens.json');

  return fs.existsSync(fallback) ? [fallback] : [];
}

function getLineStarts(code) {
  const starts = [0];

  for (let i = code.indexOf('\n'); i !== -1; i = code.indexOf('\n', i + 1)) starts.push(i + 1);

  return starts;
}

/**
 * The 1-based line and column of an offset.
 *
 * @param {number[]} lineStarts - offset of each line's first character
 * @param {number}   offset
 * @returns {{line: number, column: number}}
 */
function positionOf(lineStarts, offset) {
  let line = lineStarts.length - 1;

  while (line > 0 && lineStarts[line] > offset) line--;

  return { line: line + 1, column: offset - lineStarts[line] + 1 };
}

/**
 * Where a diagnostic points: the declaration around it (if it's in one) and
 * that declaration's start, else the diagnostic's own position.
 *
 * @param {string} code
 * @param {{line: number, column: number}} [loc]
 * @returns {object} { decl, at }
 */
function locate(code, loc) {
  if (!loc) return { decl: null, at: null };

  const lineStarts = getLineStarts(code),
    decl = source.declarationAt(code, lineStarts[loc.line - 1] + loc.column - 1);

  return { decl, at: decl ? positionOf(lineStarts, decl.start + code.slice(decl.start).search(/\S/)) : loc };
}

/**
 * Build a compiler for standard CSS: Lightning CSS only.
 *
 * Per entry file: inline its @imports (postcss-import's rules: next to the file,
 * then importPaths; a file already inlined is skipped), replace design tokens
 * (`var(--color-black)`) with their values, then one Lightning CSS pass that
 * flattens nesting (see styles-nesting.js), adds vendor prefixes and minifies.
 * `$asset-host` / `$asset-path` placeholders are filled in the text. Its diagnostics
 * come back as errors, at the source file and line.
 *
 * Paths resolve from `root`; nothing here reads process.cwd(), so the same
 * compiler runs on the main thread and in worker threads.
 *
 * @param {object} params
 * @param {string} params.root      - project root
 * @param {object} params.config    - from resolveStylesConfig()
 * @param {object} params.variables - `asset-host` and `asset-path` values
 * @param {object} params.targets   - from resolveTargets()
 * @returns {{compile: function(string, string): Promise<{warnings: object[]}>}}
 */
function createLightningCompiler({ root, config, variables, targets }) {
  const { transform, composeVisitors } = require('lightningcss');
  const options = config.lightningcssOptions || {};
  const importPaths = (config.importPaths || ['./styleguides']).map(dir => path.resolve(root, dir));
  const tokens = source.loadTokens(getTokenFiles(config, root));
  const roots = [...new Set([root, fs.realpathSync(root)])];
  const own = { Rule: { style: flattenNesting } };
  const visitor = options.visitor ? composeVisitors([own, options.visitor]) : own;

  function relative(file) {
    const rel = roots.map(dir => path.relative(dir, file)).find(r => !r.startsWith('..'));

    return rel === undefined ? file : rel;
  }

  function read(srcPath, text) {
    const readFile = file => file === srcPath && text !== undefined ? text : fs.readFileSync(file, 'utf8'),
      parts = source.inlineImports(srcPath, { importPaths, read: readFile });

    for (const part of parts) {
      const found = source.findPostcssSyntax(part.text);

      if (found) {
        throw new Error(`${relative(part.file)} uses PostCSS syntax (\`${found}\`), which the Lightning CSS pipeline ` +
          'doesn\'t read: move it to standard CSS, or set `pipeline: \'postcss\'` in stylesConfig (deprecated)');
      }
    }

    // where each line of the joined text came from
    const origins = [];

    parts.forEach(part => part.text.split('\n').forEach((line, i) => origins.push({ file: part.file, line: i + 1 })));

    const code = source.fillPlaceholders(source.inlineTokens(parts.map(part => part.text).join('\n'), tokens), variables);

    return { code, origins };
  }

  /**
   * Errors for `var()`s that look like a misspelled design token.
   *
   * @param {object} input - { code, origins, srcPath }
   * @returns {object[]} { file, line, column, message }
   */
  function unknownTokens(input) {
    const lineStarts = getLineStarts(input.code);

    return source.findUnknownTokens(input.code, tokens).map(({ offset, name, suggestion }) => {
      const at = positionOf(lineStarts, offset),
        origin = input.origins[at.line - 1];

      return { file: relative(origin.file), line: origin.line, column: at.column, message: `Unknown design token ${name} (did you mean ${suggestion}?)` };
    });
  }

  /**
   * A Lightning CSS diagnostic at the file and line it came from; for one in a
   * declaration, at the declaration's start, naming it (like the PostCSS
   * pipeline).
   *
   * @param {object} diagnostic - Lightning CSS warning
   * @param {object} input - { code, origins, srcPath }
   * @returns {object} { file, line, column, message }
   */
  function describeAt(diagnostic, { code, origins, srcPath }) {
    const { decl, at } = locate(code, diagnostic.loc),
      origin = at && origins[at.line - 1] || { file: srcPath, line: 0 },
      text = decl ? code.slice(decl.start, decl.end).trim().replace(/;$/, '').replace(/\s+/g, ' ') : '';

    return {
      file: relative(origin.file),
      line: origin.line,
      column: at ? at.column : 0,
      message: diagnostic.message + (decl ? ` in \`${text.length > 60 ? `${text.slice(0, 57)}...` : text}\`` : ''),
    };
  }

  /**
   * Compile one stylesheet: the file at srcPath, or `text` standing in for it.
   *
   * @param {string} srcPath
   * @param {string} [text]
   * @returns {object} { css, errors }
   */
  function build(srcPath, text) {
    const input = { ...read(srcPath, text), srcPath },
      result = transform({
        minify: !!config.minify,
        targets,
        errorRecovery: true,
        ...options,
        visitor,
        filename: path.relative(root, srcPath),
        code: Buffer.from(input.code),
      });

    return { css: result.code, errors: [...unknownTokens(input), ...result.warnings.map(warning => describeAt(warning, input))] };
  }

  async function compile(srcPath, destPath) {
    const { css, errors } = build(srcPath);

    await fs.outputFile(destPath, css);

    return { errors };
  }

  return {
    compile,
    // a <style> block or other CSS that isn't a file of its own; @imports
    // resolve from srcPath
    compileText: (text, srcPath) => {
      const { css, errors } = build(srcPath, text);

      return { css: css.toString(), errors };
    },
  };
}

/**
 * The compiler for the config's pipeline.
 *
 * @param {object} params - see createLightningCompiler
 * @returns {{compile: function(string, string): Promise<{warnings: object[]}>}}
 */
function createCompiler(params) {
  const pipeline = params.config.pipeline;

  if (pipeline === 'postcss') return createPostcssCompiler(params);
  if (pipeline === 'lightningcss' || pipeline === undefined) return createLightningCompiler(params);

  throw new Error(`stylesConfig pipeline must be 'lightningcss' or 'postcss', not ${JSON.stringify(pipeline)}`);
}

module.exports = {
  resolveStylesConfig,
  getTargetBrowsers,
  resolveTargets,
  createCompiler,
  createLightningCompiler,
  createPostcssCompiler,
  getTokenFiles,
  findNodeAt,
};

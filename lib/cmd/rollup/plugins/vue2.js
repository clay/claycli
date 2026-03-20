'use strict';

const path = require('path');

const CWD = process.cwd();
const KILN_CSS_DEST = path.join(CWD, 'public', 'css', '_kiln-plugins.css');

/**
 * Rollup plugin for Vue 2 Single File Components (.vue files).
 *
 * Mirrors lib/cmd/build/plugins/vue2.js but uses Rollup's
 * transform + generateBundle hooks instead of esbuild's onLoad + onEnd.
 *
 * What it does for each .vue file:
 *   1. Parses the SFC descriptor (template / script / style blocks).
 *   2. Compiles the <template> to { render, staticRenderFns }.
 *   3. Merges the compiled render functions into the component options.
 *   4. Injects <style> blocks as runtime side-effects.
 *   5. Accumulates raw CSS strings per build; writes public/css/_kiln-plugins.css on generateBundle.
 */
function vue2Plugin() {
  const cssChunks = [];

  return {
    name: 'clay-vue2',

    async transform(code, id) {
      if (!id.endsWith('.vue')) return null;

      const warn = this.warn.bind(this);
      const result = await compileSfc(id, code, warn);

      if (result && result._rawCss && result._rawCss.length) {
        cssChunks.push(...result._rawCss);
      }

      if (!result) return null;

      if (result.errors && result.errors.length) {
        result.errors.forEach(e => this.error(e.text || String(e)));
        return null;
      }

      const { _rawCss, ...rest } = result; // eslint-disable-line no-unused-vars

      return {
        code: rest.contents,
        map: null,
      };
    },

    async generateBundle() {
      if (cssChunks.length === 0) return;

      try {
        const fsExtra = require('fs-extra');

        await fsExtra.ensureDir(path.dirname(KILN_CSS_DEST));
        await fsExtra.writeFile(KILN_CSS_DEST, cssChunks.join('\n'), 'utf8');
      } catch (e) {
        console.error('[vue2] Failed to write _kiln-plugins.css:', e.message);
      }
    },
  };
}

// Node.js globals that must be replaced with browser-safe literals in Vue
// component scripts.  The values match what esbuildTransformPlugin defines for
// ordinary .js files — "__filename" → empty string, "__dirname" → root slash.
const NODE_GLOBAL_REPLACEMENTS = {
  __filename: '""',
  __dirname:  '"/"',
};

/**
 * Walk an acorn AST and collect:
 *   1. Every require(stringLiteral) CallExpression  → for import hoisting
 *   2. Every free-standing __filename / __dirname Identifier → for literal substitution
 *
 * "Free-standing" means the identifier is not used as a property name
 * (obj.__filename) or an object key (__filename: value), which mirrors the
 * behaviour of esbuild's define option.
 *
 * @param {object}   ast        - acorn Program node
 * @param {Function} onRequire  - called with { start, end, specifier }
 * @param {Function} onGlobal   - called with { start, end, replacement }
 * @param {Function} [onDynamic] - called when require() has a non-literal arg
 */
function walkScript(ast, onRequire, onGlobal, onDynamic) {
  const walk = require('acorn-walk');

  walk.ancestor(ast, {
    CallExpression(node) {
      if (node.callee.type !== 'Identifier' || node.callee.name !== 'require') return;

      if (
        node.arguments.length === 1 &&
        node.arguments[0].type === 'Literal' &&
        typeof node.arguments[0].value === 'string'
      ) {
        onRequire({ start: node.start, end: node.end, specifier: node.arguments[0].value });
      } else if (onDynamic) {
        onDynamic(node);
      }
    },

    Identifier(node, state, ancestors) {
      const replacement = NODE_GLOBAL_REPLACEMENTS[node.name];

      if (!replacement) return;

      // Skip when this identifier is used as a property name or key:
      //   obj.__filename        (MemberExpression, non-computed property)
      //   { __filename: val }   (Property key)
      const parent = ancestors[ancestors.length - 2];

      if (parent) {
        if (parent.type === 'MemberExpression' && parent.property === node && !parent.computed) return;
        if ((parent.type === 'Property' || parent.type === 'MethodDefinition') && parent.key === node && !parent.computed) return;
      }

      onGlobal({ start: node.start, end: node.end, replacement });
    },
  });
}

/**
 * Parse `code` with acorn and apply two Vue-script-specific transforms:
 *
 *   1. Hoist every static require('specifier') call to an ESM import declaration
 *      at the top of the module.  esbuildTransformPlugin (which normally handles
 *      this) filters by file extension and skips .vue files, so we do it here.
 *
 *   2. Replace Node.js globals (__filename, __dirname) with their browser-safe
 *      literal equivalents ("" and "/" respectively), matching what
 *      esbuildTransformPlugin's define map provides for ordinary .js files.
 *      The same filter applies: identifiers used as property names or object
 *      keys are left alone, mirroring esbuild's identifier-scoped define logic.
 *
 * Why AST instead of regex:
 *   - Handles require() in any syntactic position — multi-variable declarations,
 *     ternaries, function arguments, nested expressions, etc.
 *   - Uses source-range replacement (magic-string) so all character positions
 *     are correct and downstream source maps remain accurate.
 *   - Emits a build warning for dynamic require() calls instead of silently
 *     producing broken output or swallowing the call.
 *   - Falls back gracefully when the script block cannot be parsed (e.g. some
 *     edge-case syntax that acorn rejects) rather than throwing.
 *
 * The same specifier required multiple times reuses the same identifier so
 * Rollup's module graph deduplicates the resulting imports correctly.
 *
 * @param {string}   code    - raw <script> block content
 * @param {string}   filename - used only in warning messages
 * @param {Function} [warn]  - optional warn(message) callback from Rollup context
 * @returns {{ code: string, importLines: string[] }}
 */
function hoistRequires(code, filename, warn) {
  const needsRequireHoist = code && /\brequire\s*\(/.test(code);
  const needsGlobalSubst  = code && /\b(__filename|__dirname)\b/.test(code);

  if (!needsRequireHoist && !needsGlobalSubst) {
    return { code, importLines: [] };
  }

  const acorn       = require('acorn');
  const MagicString = require('magic-string');

  let ast;

  try {
    ast = acorn.parse(code, {
      ecmaVersion:              2020,
      // 'module' sourceType supports both ESM export/import AND bare require()
      // calls (require is just a regular identifier — no syntax error).
      sourceType:               'module',
      allowHashBang:            true,
      // Kiln plugin scripts sometimes have implicit return in CJS wrappers.
      allowReturnOutsideFunction: true,
    });
  } catch (parseErr) {
    // TypeScript scripts or unusual syntax acorn can't handle.  Fall back to
    // the original code; the CJS plugin may or may not handle it, but at least
    // we don't break the build.
    if (warn) warn(`[clay-vue2] could not parse <script> in ${filename} — require() / node globals will NOT be transformed (${parseErr.message})`);

    return { code, importLines: [] };
  }

  const requires    = [];
  const globals     = [];

  walkScript(
    ast,
    (req) => requires.push(req),
    (glob) => globals.push(glob),
    (node) => {
      if (warn) {
        warn(
          `[clay-vue2] dynamic require() in ${filename} at position ${node.start} ` +
          `cannot be converted to a static import — ` +
          `migrate to a top-level import declaration`
        );
      }
    }
  );

  if (requires.length === 0 && globals.length === 0) return { code, importLines: [] };

  const specToVar  = {};
  const ms         = new MagicString(code);

  for (const { start, end, specifier } of requires) {
    if (!(specifier in specToVar)) {
      specToVar[specifier] = `__cjsReq${Object.keys(specToVar).length}`;
    }

    ms.overwrite(start, end, specToVar[specifier]);
  }

  for (const { start, end, replacement } of globals) {
    ms.overwrite(start, end, replacement);
  }

  const importLines = Object.entries(specToVar).map(
    ([spec, varName]) => `import ${varName} from '${spec}';`
  );

  return { code: ms.toString(), importLines };
}

function getScriptLang(descriptor) {
  return descriptor.script && descriptor.script.lang || 'js';
}

async function compileSfc(filename, sourceCode, warn) {
  let compilerUtils, compiler;

  try {
    compilerUtils = require('@vue/component-compiler-utils');
    compiler = require('vue-template-compiler');
  } catch {
    return {
      errors: [{
        text:
          'Vue 2 SFC support requires @vue/component-compiler-utils and vue-template-compiler.\n' +
          'Install them with: npm install @vue/component-compiler-utils vue-template-compiler'
      }]
    };
  }

  const source = sourceCode;
  const isProduction = !!process.env.CLAYCLI_COMPILE_MINIFIED;
  const id = generateScopeId(filename);
  const descriptor = compilerUtils.parse({ source, filename, compiler, needMap: false });

  const errors = [];
  const parts = [];
  const rawCss = [];

  const scriptContent = descriptor.script
    ? descriptor.script.content.trim()
    : '';
  const lang = getScriptLang(descriptor);

  // Convert any require('specifier') expressions to ESM import declarations.
  // @rollup/plugin-commonjs does not reliably process .vue files even with an
  // explicit `include` filter — it skips the require() → import conversion for
  // non-JS extensions.  Hoisting requires here gives Rollup a pure-ESM module
  // with no CJS residue, which it can link correctly regardless of plugin order.
  const { code: scriptWithImports, importLines } = hoistRequires(scriptContent || '', filename, warn);

  const usesCjsExport = /\bmodule\.exports\s*=/.test(scriptWithImports);

  let scriptBody;

  if (usesCjsExport) {
    scriptBody = scriptWithImports
      .replace(/\bmodule\.exports\s*=\s*/, 'const __sfc__ = ');
  } else {
    scriptBody = scriptWithImports
      ? scriptWithImports.replace(/\bexport\s+default\b/, 'const __sfc__ =')
      : 'const __sfc__ = {};';
  }

  // Prepend the hoisted ESM imports (if any) before the script body so they
  // appear at the module's top level where import declarations are valid.
  if (importLines.length) {
    parts.push(importLines.join('\n'));
  }

  parts.push(scriptBody);

  const ctx = { filename, isProduction, id, parts, rawCss };

  const templateErrors = compileTemplate({ descriptor, compilerUtils, compiler, ctx });

  errors.push(...templateErrors);

  const styleErrors = compileStyles({ descriptor, compilerUtils, ctx });

  errors.push(...styleErrors);

  if (errors.length) {
    return { errors };
  }

  parts.push('export default __sfc__;');

  return {
    contents: parts.join('\n'),
    loader: lang === 'ts' ? 'ts' : 'js',
    resolveDir: path.dirname(filename),
    _rawCss: rawCss,
  };
}

function compileTemplate({ descriptor, compilerUtils, compiler, ctx }) {
  if (!descriptor.template) return [];

  const { filename, isProduction, id, parts } = ctx;
  const hasScopedStyles = descriptor.styles.some(s => s.scoped);
  const scopeOpts = hasScopedStyles ? { scoped: true, scopeId: `data-v-${id}` } : {};
  const templateResult = compilerUtils.compileTemplate({
    source: descriptor.template.content,
    filename,
    compiler,
    isProduction,
    compilerOptions: { whitespace: 'condense' },
    ...scopeOpts,
  });

  if (templateResult.errors && templateResult.errors.length) {
    return templateResult.errors.map(e => ({ text: String(e) }));
  }

  parts.push(
    templateResult.code,
    'if (typeof __sfc__ !== "undefined") {',
    '  __sfc__.render = render;',
    '  __sfc__.staticRenderFns = staticRenderFns;',
    '}'
  );

  if (hasScopedStyles) {
    parts.push(`if (typeof __sfc__ !== "undefined") { __sfc__._scopeId = "data-v-${id}"; }`);
  }

  return [];
}

function compileStyles({ descriptor, compilerUtils, ctx }) {
  const { filename, id, parts, rawCss } = ctx;
  const errors = [];

  for (const style of descriptor.styles) {
    let css = style.content.trim();

    if (!css) continue;

    if (style.scoped) {
      try {
        const result = compilerUtils.compileStyle({
          source: css,
          filename,
          id: `data-v-${id}`,
          scoped: true,
        });

        if (result.errors && result.errors.length) {
          errors.push(...result.errors.map(e => ({ text: String(e) })));
          continue;
        }

        css = result.code;
      } catch (e) {
        errors.push({ text: `Style compilation error in ${filename}: ${e.message}` });
        continue;
      }
    }

    parts.push(injectStyleSnippet(css));

    if (rawCss) {
      rawCss.push(css);
    }
  }

  return errors;
}

function generateScopeId(filepath) {
  let hash = 5381;
  const str = filepath;

  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) + hash ^ str.charCodeAt(i);
    hash = hash >>> 0;
  }

  return hash.toString(16).padStart(8, '0');
}

function injectStyleSnippet(css) {
  const escaped = JSON.stringify(css);

  return [
    ';(function() {',
    '  if (typeof document === "undefined") return;',
    `  var __css__ = ${escaped};`,
    '  var __el__ = document.createElement("style");',
    '  __el__.textContent = __css__;',
    '  document.head.appendChild(__el__);',
    '})();',
  ].join('\n');
}

module.exports = vue2Plugin;

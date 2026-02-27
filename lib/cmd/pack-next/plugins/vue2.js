'use strict';

const fs = require('fs').promises;
const path = require('path');

/**
 * esbuild plugin for Vue 2 Single File Components (.vue files).
 *
 * Requires peer dependencies:
 *   @vue/component-compiler-utils  (^3.x)
 *   vue-template-compiler          (must match your Vue 2 version)
 *
 * What it does for each .vue file:
 *   1. Parses the SFC descriptor (template / script / style blocks).
 *   2. Compiles the <template> to { render, staticRenderFns } using vue-template-compiler.
 *   3. Merges the compiled render functions into the component options object from <script>.
 *   4. Injects <style> blocks as runtime side-effects (document.createElement('style')).
 *
 * Scoped styles are compiled but their attribute selector (_v-XXXXXXXX) is inserted
 * into the component options so Vue's runtime can apply them.
 */
function vue2Plugin() {
  return {
    name: 'clay-vue2',
    setup(build) {
      build.onLoad({ filter: /\.vue$/ }, args => compileSfc(args.path));
    }
  };
}

/**
 * Compile a single Vue 2 SFC file to a JS module string.
 *
 * @param {string} filename - Absolute path to the .vue file.
 * @returns {Promise}
 */
async function compileSfc(filename) {
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

  const source = await fs.readFile(filename, 'utf8');
  const isProduction = !!process.env.CLAYCLI_COMPILE_MINIFIED;
  const id = generateScopeId(filename);
  const descriptor = compilerUtils.parse({ source, filename, compiler, needMap: false });

  const errors = [];
  const parts = [];

  // --- Script block -------------------------------------------------------
  const scriptContent = descriptor.script
    ? descriptor.script.content.trim()
    : '';
  const lang = descriptor.script && descriptor.script.lang || 'js';

  // Capture the component options object under a known name so render
  // functions can be injected before the final re-export. Handles both the
  // modern ESM style (`export default { ... }`) and the legacy CJS style
  // (`module.exports = { ... }`) that the sites repo uses in .vue files.
  //
  // Track whether the source used CJS exports so we can mirror that in the
  // output. If we always emit `export default` for CJS sources, esbuild's
  // interop wraps require('./foo.vue') in { default: component } and Vue
  // never sees the render function at the top level.
  const usesCjsExport = /\bmodule\.exports\s*=/.test(scriptContent);
  const scriptBody = scriptContent
    ? scriptContent
      .replace(/\bexport\s+default\b/, 'const __sfc__ =')
      .replace(/\bmodule\.exports\s*=\s*/, 'const __sfc__ = ')
    : 'const __sfc__ = {};';

  parts.push(scriptBody);

  const ctx = { filename, isProduction, id, parts };

  // --- Template block -----------------------------------------------------
  const templateErrors = compileTemplate({ descriptor, compilerUtils, compiler, ctx });

  errors.push(...templateErrors);

  // --- Style blocks -------------------------------------------------------
  const styleErrors = compileStyles({ descriptor, compilerUtils, ctx });

  errors.push(...styleErrors);

  if (errors.length) {
    return { errors };
  }

  // Mirror the original export style. CJS sources must stay CJS so that
  // require('./foo.vue') returns the component object directly instead of an
  // ESM namespace wrapper ({ default: component }), which would cause Vue to
  // report "template or render function not defined".
  if (usesCjsExport) {
    parts.push('module.exports = __sfc__; module.exports.default = __sfc__;');
  } else {
    parts.push('export default __sfc__;');
  }

  return {
    contents: parts.join('\n'),
    loader: lang === 'ts' ? 'ts' : 'js',
    resolveDir: path.dirname(filename),
  };
}

/**
 * Compile the <template> block and push the result into `parts`.
 *
 * @param {object} opts
 * @param {object} opts.descriptor
 * @param {object} opts.compilerUtils
 * @param {object} opts.compiler
 * @param {object} opts.ctx - { filename, isProduction, id, parts }
 * @returns {Array} Any errors encountered.
 */
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

/**
 * Compile each <style> block and push runtime injection snippets into `parts`.
 *
 * @param {object} opts
 * @param {object} opts.descriptor
 * @param {object} opts.compilerUtils
 * @param {object} opts.ctx - { filename, id, parts }
 * @returns {Array} Any errors encountered.
 */
function compileStyles({ descriptor, compilerUtils, ctx }) {
  const { filename, id, parts } = ctx;
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
  }

  return errors;
}

/**
 * Generate a short, stable scope ID from a file path.
 * Mirrors what vue-loader does internally.
 *
 * @param {string} filepath
 * @returns {string} 8-character hex string
 */
function generateScopeId(filepath) {
  let hash = 5381;
  const str = filepath;

  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) + hash ^ str.charCodeAt(i);
    hash = hash >>> 0; // keep unsigned 32-bit
  }

  return hash.toString(16).padStart(8, '0');
}

/**
 * Returns a JS snippet that injects a CSS string into the document at runtime.
 *
 * @param {string} css
 * @returns {string}
 */
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

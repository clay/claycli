'use strict';

const fsSync = require('fs');
const fs = fsSync.promises;
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

      const result = await compileSfc(id);

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

function getScriptLang(descriptor) {
  return descriptor.script && descriptor.script.lang || 'js';
}

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
  const rawCss = [];

  const scriptContent = descriptor.script
    ? descriptor.script.content.trim()
    : '';
  const lang = getScriptLang(descriptor);

  const usesCjsExport = /\bmodule\.exports\s*=/.test(scriptContent);
  const scriptBody = scriptContent
    ? scriptContent
      .replace(/\bexport\s+default\b/, 'const __sfc__ =')
      .replace(/\bmodule\.exports\s*=\s*/, 'const __sfc__ = ')
    : 'const __sfc__ = {};';

  parts.push(scriptBody);

  const ctx = { filename, isProduction, id, parts, rawCss };

  const templateErrors = compileTemplate({ descriptor, compilerUtils, compiler, ctx });

  errors.push(...templateErrors);

  const styleErrors = compileStyles({ descriptor, compilerUtils, ctx });

  errors.push(...styleErrors);

  if (errors.length) {
    return { errors };
  }

  if (usesCjsExport) {
    parts.push('module.exports = __sfc__; module.exports.default = __sfc__;');
  } else {
    parts.push('export default __sfc__;');
  }

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

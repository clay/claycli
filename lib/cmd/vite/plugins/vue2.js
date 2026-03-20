'use strict';

const fs = require('fs');
const fsExtra = require('fs-extra');
const path = require('path');

const CWD = process.cwd();
const KILN_CSS_DEST = path.join(CWD, 'public', 'css', '_kiln-plugins.css');

/**
 * Vite/Rollup plugin for Vue 2 Single File Components (.vue files).
 *
 * Compiles .vue files using @vue/component-compiler-utils and vue-template-compiler.
 * Runs with enforce:'pre' to handle .vue files before Vite's default transform
 * pipeline (which does not know about Vue 2 SFCs).
 *
 * Per .vue file:
 *   1. Parses the SFC descriptor (template / script / style blocks)
 *   2. Compiles <template> → { render, staticRenderFns }
 *   3. Handles export default and module.exports = in <script>
 *   4. Injects <style> blocks as runtime IIFE side-effects
 *   5. Accumulates raw CSS; writes public/css/_kiln-plugins.css on closeBundle
 *
 * Scoped styles use a djb2 hash of the file path as the scope ID
 * (data-v-{8hex chars}), matching the rollup pipeline's behaviour.
 */
function viteVue2Plugin() {
  const cssChunks = [];

  return {
    name: 'clay-vite-vue2',
    enforce: 'pre',

    async transform(code, id) {
      if (!id.endsWith('.vue')) return null;

      let compilerUtils, compiler;

      try {
        compilerUtils = require('@vue/component-compiler-utils');
        compiler = require('vue-template-compiler');
      } catch (e) {
        this.error(
          'Vue 2 SFC support requires @vue/component-compiler-utils and vue-template-compiler.\n' +
          `Run: npm install @vue/component-compiler-utils vue-template-compiler\n${e.message}`
        );
        return null;
      }

      const isProduction = !!process.env.CLAYCLI_COMPILE_MINIFIED;
      const scopeId = computeScopeId(id);

      let source;

      try {
        source = fs.readFileSync(id, 'utf8');
      } catch (e) {
        this.warn(`[clay-vite-vue2] could not read ${id}: ${e.message}`);
        return null;
      }

      const descriptor = compilerUtils.parse({ source, filename: id, compiler, needMap: false });
      const parts = [];
      const rawCss = [];

      // ── Script block ───────────────────────────────────────────────────────
      const scriptContent = descriptor.script
        ? descriptor.script.content.trim()
        : '';

      const scriptBody = scriptContent
        ? scriptContent
            .replace(/\bexport\s+default\b/, 'const __sfc__ =')
            .replace(/\bmodule\.exports\s*=\s*/, 'const __sfc__ = ')
        : 'const __sfc__ = {};';

      parts.push(scriptBody);

      // ── Template block ─────────────────────────────────────────────────────
      if (descriptor.template) {
        const hasScopedStyles = descriptor.styles.some(s => s.scoped);
        const templateOpts = {
          source: descriptor.template.content,
          filename: id,
          compiler,
          isProduction,
          compilerOptions: { whitespace: 'condense' },
        };

        if (hasScopedStyles) {
          templateOpts.scoped = true;
          templateOpts.scopeId = `data-v-${scopeId}`;
        }

        const templateResult = compilerUtils.compileTemplate(templateOpts);

        if (templateResult.errors && templateResult.errors.length) {
          templateResult.errors.forEach(e => this.warn(String(e)));
        } else {
          parts.push(templateResult.code);
          parts.push(
            'if (typeof __sfc__ !== "undefined") {',
            '  __sfc__.render = render;',
            '  __sfc__.staticRenderFns = staticRenderFns;',
            '}'
          );

          if (hasScopedStyles) {
            parts.push(`if (typeof __sfc__ !== "undefined") { __sfc__._scopeId = "data-v-${scopeId}"; }`);
          }
        }
      }

      // ── Style blocks ───────────────────────────────────────────────────────
      for (const style of descriptor.styles) {
        let css = style.content.trim();

        if (!css) continue;

        if (style.scoped) {
          try {
            const result = compilerUtils.compileStyle({
              source: css,
              filename: id,
              id: `data-v-${scopeId}`,
              scoped: true,
            });

            if (result.errors && result.errors.length) continue;

            css = result.code;
          } catch (_) {
            continue;
          }
        }

        parts.push(injectStyleIIFE(css));
        rawCss.push(css);
      }

      // ── ESM export ─────────────────────────────────────────────────────────
      parts.push('export default __sfc__;');

      if (rawCss.length) cssChunks.push(...rawCss);

      return { code: parts.join('\n'), map: null };
    },

    async closeBundle() {
      if (cssChunks.length === 0) return;

      try {
        await fsExtra.ensureDir(path.dirname(KILN_CSS_DEST));
        await fsExtra.writeFile(KILN_CSS_DEST, cssChunks.join('\n'), 'utf8');
      } catch (e) {
        console.error('[clay-vite-vue2] Failed to write _kiln-plugins.css:', e.message);
      }
    },
  };
}

/**
 * djb2 hash of the file path → 8-char hex scope ID.
 * Matches the rollup pipeline's vue2Plugin behaviour so that scoped-style
 * class names are stable across bundler switches.
 *
 * @param {string} filepath
 * @returns {string}
 */
function computeScopeId(filepath) {
  let hash = 5381;

  for (let i = 0; i < filepath.length; i++) {
    hash = ((hash << 5) + hash) ^ filepath.charCodeAt(i);
    hash = hash >>> 0;
  }

  return hash.toString(16).padStart(8, '0');
}

/**
 * Return an IIFE that injects a <style> element at runtime.
 *
 * @param {string} css
 * @returns {string}
 */
function injectStyleIIFE(css) {
  return [
    ';(function() {',
    '  if (typeof document === "undefined") return;',
    `  var __css__ = ${JSON.stringify(css)};`,
    '  var __el__ = document.createElement("style");',
    '  __el__.textContent = __css__;',
    '  document.head.appendChild(__el__);',
    '})();',
  ].join('\n');
}

module.exports = viteVue2Plugin;

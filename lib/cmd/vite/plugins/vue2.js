'use strict';

const fs = require('fs');
const fsExtra = require('fs-extra');
const path = require('path');

const CWD = process.cwd();
const KILN_CSS_DEST = path.join(CWD, 'public', 'css', '_kiln-plugins.css');

// PostCSS plugins applied to every <style> block in a kiln plugin .vue file.
// Mirrors the chain that @nymag/vueify runs in the legacy Browserify pipeline
// (cssImport → autoprefixer → mixins → nested → simple-vars) so kiln plugin
// styles built under `clay vite` look identical to those built under
// `clay compile scripts`.
//
// Without this, source like `.foo { &-bar { … } }` reaches the browser as a
// nested rule that no UA can parse, and entire plugin modals (article-picker,
// agora, …) render unstyled.
//
// Plugins are resolved from the host project's node_modules at first use so
// host-side versions (e.g. PostCSS 7) are honoured rather than claycli's own
// dependency tree (which may be a different major). Anything that fails to
// resolve is silently dropped — the chain still runs the plugins it found,
// matching the legacy "best-effort" behaviour.
const VUE_POSTCSS_PLUGINS = [
  'postcss-import',
  'autoprefixer',
  'postcss-mixins',
  'postcss-nested',
  'postcss-simple-vars',
];

/**
 * Resolve {postcss, plugins[]} from the host project's node_modules.
 * Returns null if PostCSS itself is missing — the caller falls back to the
 * raw style source in that case (no worse than the pre-fix behaviour).
 *
 * Cached per-process to avoid the resolve cost on every transform.
 *
 * @returns {{postcss: Function, plugins: Function[]} | null}
 */
let cachedPostcssChain;

function getHostPostcssChain() {
  if (cachedPostcssChain !== undefined) return cachedPostcssChain;
  cachedPostcssChain = null;

  let postcss;

  try {
    postcss = require(require.resolve('postcss', { paths: [CWD] }));
  } catch (_) {
    return null;
  }

  const plugins = [];

  for (const name of VUE_POSTCSS_PLUGINS) {
    try {
      const plugin = require(require.resolve(name, { paths: [CWD] }));

      plugins.push(typeof plugin === 'function' ? plugin() : plugin);
    } catch (_) {
      // Plugin not installed in host project — skip it. postcss-mixins is
      // commonly absent and was previously a transitive of vueify only.
    }
  }

  cachedPostcssChain = { postcss, plugins };
  return cachedPostcssChain;
}

/**
 * Vite plugin for Vue 2 Single File Components (.vue files).
 *
 * Compiles .vue files using @vue/component-compiler-utils and vue-template-compiler.
 * Runs with enforce:'pre' so it fires before Vite's standard JS transform pipeline,
 * which does not understand Vue 2 SFC syntax.
 *
 * Per .vue file:
 *   1. Parses the SFC descriptor (template / script / style blocks).
 *   2. Compiles <template> to { render, staticRenderFns } via vue-template-compiler.
 *   3. Normalises the <script> block: converts `export default` or `module.exports =`
 *      to `const __sfc__ = …` so the rest of the output is consistent.
 *   4. Injects <style> blocks as runtime IIFEs (document.createElement('style')).
 *   5. Accumulates raw CSS and writes public/css/_kiln-plugins.css on closeBundle.
 *
 * Scoped styles use a djb2 hash of the file path as the data-v-XXXXXXXX scope ID,
 * ensuring stable class names that survive recompilation without changes to
 * server-rendered HTML.
 *
 * ── Vue 3 migration path ─────────────────────────────────────────────────────
 *
 * New components should be written as Vue 3 SFCs using the Composition API.
 * To enable Vue 3 compilation alongside legacy Vue 2 files, add @vitejs/plugin-vue
 * to bundlerConfig().plugins in claycli.config.js:
 *
 *   const vuePlugin = require('@vitejs/plugin-vue');
 *   config.plugins.push(vuePlugin());
 *
 * Both plugins can coexist: this plugin handles .vue files that use Vue 2 APIs
 * (Options API, Vue.component(), vue-template-compiler), and @vitejs/plugin-vue
 * handles .vue files that use Vue 3 APIs (defineComponent, <script setup>).
 * A file-naming convention or directory split can be used to distinguish them
 * until migration is complete.
 *
 * Once all .vue files are migrated to Vue 3, remove this plugin.
 *
 * ── CSS accumulation note ────────────────────────────────────────────────────
 *
 * In two-pass mode (kilnSplit:false), two instances of this plugin run in
 * parallel — one for the view pass and one for the kiln pass.  Both write to
 * the same KILN_CSS_DEST file in their closeBundle hook.  In practice only
 * kiln-pass .vue files have <style> blocks, so the view-pass instance exits
 * early via the `if (cssChunks.length === 0) return` guard and does not write.
 * If view-mode .vue files ever acquire <style> blocks, the two instances would
 * race; the last one to finish would win.  Address this by moving CSS
 * accumulation to a shared module-level store if that case arises.
 */
/**
 * Normalise the <script> block of a Vue 2 SFC into a `const __sfc__ = …`
 * assignment.  Both `export default` and `module.exports =` are handled so
 * the rest of the output is consistent regardless of the author's style.
 *
 * @param {string} scriptContent  trimmed content of the <script> block
 * @returns {string}
 */
function normalizeScriptBlock(scriptContent) {
  if (!scriptContent) return 'const __sfc__ = {};';

  return scriptContent
    .replace(/\bexport\s+default\b/, 'const __sfc__ =')
    .replace(/\bmodule\.exports\s*=\s*/, 'const __sfc__ = ');
}

/**
 * Compile the <template> block and append the resulting render functions
 * to the `parts` array.  Mutates parts in place.
 *
 * @param {object}   ctx            context object
 * @param {object}   ctx.descriptor parsed SFC descriptor
 * @param {object}   ctx.compilerUtils @vue/component-compiler-utils
 * @param {object}   ctx.compiler   vue-template-compiler
 * @param {string}   ctx.id         file path
 * @param {boolean}  ctx.isProduction
 * @param {string}   ctx.scopeId    djb2 hash of the file path
 * @param {string[]} ctx.parts      output code parts (mutated)
 * @param {function} ctx.warn       Rollup warn function
 */
function processTemplateBlock(ctx) {
  const { descriptor, compilerUtils, compiler, id, isProduction, scopeId, parts, warn } = ctx;

  if (!descriptor.template) return;

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
    templateResult.errors.forEach(e => warn(String(e)));
    return;
  }

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

/**
 * Run the host project's PostCSS chain over a single <style> block.
 * Returns the transformed CSS, or the original source if no chain is
 * available or processing throws (matches legacy best-effort behaviour).
 *
 * @param {string} source
 * @param {string} filename
 * @param {function} warn  Rollup warn function
 * @returns {Promise<string>}
 */
async function runHostPostcss(source, filename, warn) {
  const chain = getHostPostcssChain();

  if (!chain || chain.plugins.length === 0) return source;

  try {
    const result = await chain.postcss(chain.plugins).process(source, {
      from: filename,
      to: filename,
      // Silence "no-op processor" warnings when the host has only postcss
      // installed but none of the plugin packages.
      map: false,
    });

    return result.css;
  } catch (e) {
    warn(`[clay-vite-vue2] postcss failed for ${filename}: ${e.message}`);
    return source;
  }
}

/**
 * Compile each <style> block and append runtime injection IIFEs to `parts`.
 * Raw CSS strings are pushed to `rawCss` for the kiln plugin CSS file.
 * Both arrays are mutated in place.
 *
 * Each block is run through the host project's PostCSS chain first so that
 * `<style lang="postcss">` source — which can use nesting (`&-foo`),
 * `@mixin`, simple variables, etc. — reaches the browser as flat,
 * standards-compliant CSS. Scope-id rewriting (for `<style scoped>`) is then
 * applied on top of the already-flattened CSS via @vue/component-compiler-utils.
 *
 * @param {object}   ctx              context object
 * @param {object}   ctx.descriptor   parsed SFC descriptor
 * @param {object}   ctx.compilerUtils @vue/component-compiler-utils
 * @param {string}   ctx.id           file path
 * @param {string}   ctx.scopeId      djb2 hash of the file path
 * @param {string[]} ctx.parts        output code parts (mutated)
 * @param {string[]} ctx.rawCss       accumulated raw CSS (mutated)
 * @param {function} ctx.warn         Rollup warn function
 */
async function processStyleBlocks(ctx) {
  const { descriptor, compilerUtils, id, scopeId, parts, rawCss, warn } = ctx;

  for (const style of descriptor.styles) {
    const rawSource = style.content.trim();

    if (!rawSource) continue;

    let css = await runHostPostcss(rawSource, id, warn);

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
}

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
      const parts  = [];
      const rawCss = [];

      // ── Script block ───────────────────────────────────────────────────────
      const scriptContent = descriptor.script ? descriptor.script.content.trim() : '';

      parts.push(normalizeScriptBlock(scriptContent));

      // ── Template block ─────────────────────────────────────────────────────
      processTemplateBlock({ descriptor, compilerUtils, compiler, id, isProduction, scopeId, parts, warn: this.warn.bind(this) });

      // ── Style blocks ───────────────────────────────────────────────────────
      await processStyleBlocks({ descriptor, compilerUtils, id, scopeId, parts, rawCss, warn: this.warn.bind(this) });

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
    hash = (hash << 5) + hash ^ filepath.charCodeAt(i);
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

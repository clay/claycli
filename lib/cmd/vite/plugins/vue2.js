'use strict';

const fs = require('fs');
const fsExtra = require('fs-extra');
const path = require('path');
const { resolveKilnPostcssChain } = require('../../../postcss-chain');
const { getConfigFileOrBrowsersList } = require('../../../compilation-helpers');

const CWD = process.cwd();
const KILN_CSS_DEST = path.join(CWD, 'public', 'css', '_kiln-plugins.css');

/**
 * Resolve {postcss, plugins[]} from the host project's node_modules via the
 * shared lib/postcss-chain.js resolver (used by BOTH `clay vite` and
 * `clay compile`, so the two pipelines can't silently drift apart again).
 *
 * autoprefixerOptions is threaded through `getConfigFileOrBrowsersList`
 * (the SAME helper `clay compile`'s Vue chain already uses — see
 * lib/cmd/compile/scripts.js buildVuePostcssChain) rather than this
 * pipeline's own `stylesConfig` hook: this chain's whole purpose is to look
 * identical to what `clay compile scripts` produces for Kiln plugin styles
 * (see the module doc above), not to match this pipeline's OWN component CSS
 * (lib/cmd/vite/styles.js), which is intentionally on a separate
 * `stylesConfig`-driven config path documented in claycli.config.js.
 *
 * Returns null if PostCSS itself is missing from the host tree — the caller
 * falls back to the raw style source in that case (no worse than the
 * pre-fix behaviour). Every missing/incompatible plugin is reported via
 * console.warn (see lib/postcss-chain.js) rather than silently dropped.
 *
 * Cached per-process to avoid the resolve cost on every transform.
 *
 * @returns {{postcss: Function, plugins: Function[]} | null}
 */
let cachedPostcssChain;

function getHostPostcssChain() {
  if (cachedPostcssChain !== undefined) return cachedPostcssChain;

  cachedPostcssChain = resolveKilnPostcssChain({
    cwd: CWD,
    pluginArgs: {
      autoprefixer: [getConfigFileOrBrowsersList('autoprefixerOptions')],
    },
  });

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
 * Scope-id wiring for the *template's compiled render output* (adding the
 * `data-v-XXXXXXXX` attribute to elements the compiler statically knows
 * about) only applies when there IS a template to compile. Setting
 * `__sfc__._scopeId` itself is a separate, unconditional concern — see
 * `applyScopeId` below — an SFC can have `<style scoped>` with no
 * `<template>` block at all (e.g. a `render()` function or `template:`
 * string written directly in `<script>`), and its CSS still needs to match.
 *
 * @param {object}   ctx            context object
 * @param {object}   ctx.descriptor parsed SFC descriptor
 * @param {object}   ctx.compilerUtils @vue/component-compiler-utils
 * @param {object}   ctx.compiler   vue-template-compiler
 * @param {string}   ctx.id         file path
 * @param {boolean}  ctx.isProduction
 * @param {boolean}  ctx.hasScopedStyles
 * @param {string}   ctx.scopeId    djb2 hash of the file path
 * @param {string[]} ctx.parts      output code parts (mutated)
 * @param {function} ctx.warn       Rollup warn function
 */
function processTemplateBlock(ctx) {
  const { descriptor, compilerUtils, compiler, id, isProduction, hasScopedStyles, scopeId, parts, warn } = ctx;

  if (!descriptor.template) return;

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
}

/**
 * Assign `__sfc__._scopeId` whenever any <style> block is scoped, regardless
 * of whether the SFC has a <template> block. `_scopeId` is what
 * @vue/component-compiler-utils's compiled render output and the CSS's own
 * `[data-v-XXXXXXXX]` attribute selectors (added by compileStyle in
 * processStyleBlocks) both key off of at runtime; an SFC that skips
 * <template> (a `render()` function or `template:` string written directly
 * in <script>) still needs its scoped CSS to match against something.
 *
 * Matches @nymag/vueify's legacy behaviour, which set this unconditionally
 * off `hasScopedStyle` with no <template> dependency
 * (@nymag/vueify/lib/compiler.js).
 *
 * @param {boolean}  hasScopedStyles
 * @param {string}   scopeId
 * @param {string[]} parts  output code parts (mutated)
 */
function applyScopeId(hasScopedStyles, scopeId, parts) {
  if (!hasScopedStyles) return;

  parts.push(`if (typeof __sfc__ !== "undefined") { __sfc__._scopeId = "data-v-${scopeId}"; }`);
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

// Preprocessors dispatched by <style lang="..."> before the PostCSS chain
// runs, matching @nymag/vueify's legacy behaviour (its compiler.js dispatches
// lang to a real preprocessor rather than feeding preprocessor syntax
// straight into PostCSS). Each entry resolves its package from the HOST
// project — same tree the Kiln PostCSS chain resolves from — and renders
// synchronously against a Promise so callers don't need a second code path.
//
// Unlisted / unset lang values (undefined, 'css', 'postcss') are left alone:
// they are exactly what the PostCSS chain already expects.
const STYLE_PREPROCESSORS = {
  scss: { pkg: 'sass', render: renderSass },
  sass: { pkg: 'sass', render: (source, filename, mod) => renderSass(source, filename, mod, true) },
  less: { pkg: 'less', render: renderLess },
  stylus: { pkg: 'stylus', render: renderStylus },
};

function renderSass(source, filename, sass, indentedSyntax) {
  return new Promise((resolve, reject) => {
    sass.render(
      { data: source, file: filename, indentedSyntax: !!indentedSyntax, includePaths: [path.dirname(filename)] },
      (err, res) => (err ? reject(err) : resolve(res.css.toString()))
    );
  });
}

function renderLess(source, filename, less) {
  return new Promise((resolve, reject) => {
    less.render(source, { filename }, (err, out) => (err ? reject(err) : resolve(out.css)));
  });
}

async function renderStylus(source, filename, stylus) {
  return stylus.render(source, { filename });
}

/**
 * Preprocess a single <style> block's source according to its `lang`
 * attribute. Throws (does not warn) when a KNOWN preprocessor lang is
 * requested but its package isn't installed in the host project — an
 * incomplete preprocess is not a safe degrade-to-raw-source case the way a
 * missing PostCSS chain plugin is (see runHostPostcss): the source isn't
 * valid CSS at all yet, so shipping it unprocessed ships broken selectors
 * and declarations with no indication anything went wrong. The caller
 * surfaces this via `this.error()`, matching the existing precedent for a
 * missing preprocessor package in the legacy `clay compile` pipeline
 * (lib/cmd/compile/scripts.js's compileSassWithDartSass).
 *
 * @param {string} source
 * @param {string} filename
 * @param {string} [lang]
 * @returns {Promise<string>}
 */
async function preprocessStyleLang(source, filename, lang) {
  const entry = STYLE_PREPROCESSORS[(lang || '').toLowerCase()];

  if (!entry) return source;

  let mod;

  try {
    mod = require(require.resolve(entry.pkg, { paths: [CWD] }));
  } catch (_) {
    throw new Error(
      `<style lang="${lang}"> requires the "${entry.pkg}" package, which is ` +
      `not installed. Run: npm install ${entry.pkg}`
    );
  }

  return entry.render(source, filename, mod);
}

/**
 * Compile each <style> block and append runtime injection IIFEs to `parts`.
 * Raw CSS strings are pushed to `rawCss` for the kiln plugin CSS file.
 * Both arrays are mutated in place.
 *
 * Each block is preprocessed by its `lang` (scss/sass/less/stylus — see
 * preprocessStyleLang) and then run through the host project's PostCSS chain
 * so that nesting (`&-foo`), `@mixin`, simple variables, etc. reach the
 * browser as flat, standards-compliant CSS. Scope-id rewriting (for
 * `<style scoped>`) is then applied on top of the already-flattened CSS via
 * @vue/component-compiler-utils.
 *
 * @param {object}   ctx              context object
 * @param {object}   ctx.descriptor   parsed SFC descriptor
 * @param {object}   ctx.compilerUtils @vue/component-compiler-utils
 * @param {string}   ctx.id           file path
 * @param {string}   ctx.scopeId      djb2 hash of the file path
 * @param {string[]} ctx.parts        output code parts (mutated)
 * @param {string[]} ctx.rawCss       accumulated raw CSS (mutated)
 * @param {function} ctx.warn         Rollup warn function
 * @param {function} ctx.error        Rollup error function (throws, halts the build)
 */
async function processStyleBlocks(ctx) {
  const { descriptor, compilerUtils, id, scopeId, parts, rawCss, warn, error } = ctx;

  for (const style of descriptor.styles) {
    const rawSource = style.content.trim();

    if (!rawSource) continue;

    let preprocessed;

    try {
      preprocessed = await preprocessStyleLang(rawSource, id, style.lang);
    } catch (e) {
      error(`[clay-vite-vue2] ${e.message}`);
      return;
    }

    let css = await runHostPostcss(preprocessed, id, warn);

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
      const hasScopedStyles = descriptor.styles.some(s => s.scoped);

      // ── Script block ───────────────────────────────────────────────────────
      const scriptContent = descriptor.script ? descriptor.script.content.trim() : '';

      parts.push(normalizeScriptBlock(scriptContent));

      // ── Template block ─────────────────────────────────────────────────────
      processTemplateBlock({ descriptor, compilerUtils, compiler, id, isProduction, hasScopedStyles, scopeId, parts, warn: this.warn.bind(this) });

      // ── Style blocks ───────────────────────────────────────────────────────
      await processStyleBlocks({ descriptor, compilerUtils, id, scopeId, parts, rawCss, warn: this.warn.bind(this), error: this.error.bind(this) });

      // ── Scope id (independent of whether a <template> block exists) ────────
      applyScopeId(hasScopedStyles, scopeId, parts);

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

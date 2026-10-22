'use strict';

const fs = require('fs');
const fsExtra = require('fs-extra');
const path = require('path');
const hashSum = require('hash-sum');
const { resolveKilnPostcssChain } = require('../../../postcss-chain');
const { getConfigFileOrBrowsersList } = require('../../../compilation-helpers');
const { getConfigValue } = require('../../../config-file-helpers');
const { resolveStylesConfig, resolveTargets, createLightningCompiler } = require('../styles-compiler');

const CWD = process.cwd();
const KILN_CSS_DEST = path.join(CWD, 'public', 'css', '_kiln-plugins.css');

// Shared across every viteVue2Plugin() instance in this process — see the
// "CSS accumulation note" in the module doc comment below for why this is
// deliberately module-level rather than per-instance.  Keyed by .vue file id,
// so re-transforming a file (a rebuilt pass, a watch rebuild) replaces its
// styles instead of appending a second copy.
const cssByFile = new Map();
// Serializes writes of KILN_CSS_DEST: both passes' closeBundle write it, and
// two overlapping fs.writeFile calls on one path can leave a mix of both.

let cssWriteQueue = Promise.resolve();

/**
 * _kiln-plugins.css content: every accumulated <style> block, files in
 * path order relative to the project root.  Transforms finish in whatever
 * order their async PostCSS runs complete, so insertion order is not stable
 * from one build to the next; path order is, and it doesn't depend on where
 * the project is checked out.
 *
 * @returns {{css: string, blocks: number}}
 */
function kilnCssContent() {
  const rel = id => path.relative(CWD, id).split(path.sep).join('/');
  // Plain code-unit order (Array#sort's default), not localeCompare, which
  // depends on the build machine's locale.
  const files = [...cssByFile.keys()].map(id => [rel(id), id]).sort().map(([, id]) => id);
  const blocks = files.flatMap(id => cssByFile.get(id));

  return { css: blocks.join('\n'), blocks: blocks.length };
}

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
 * Resolve cssnano from the HOST project's node_modules — the SAME tree
 * getHostPostcssChain() resolves from, never claycli's own bundled copy.
 * Mixing trees here would reproduce exactly the crash lib/postcss-chain.js
 * exists to prevent: claycli's own cssnano is built against claycli's own
 * postcss8, and running it through a host's postcss7 instance throws.
 *
 * Missing cssnano is NOT treated as fatal, unlike a missing preprocessor
 * (see preprocessStyleLang): unminified CSS is still correct CSS, just
 * larger, so this degrades to "skip minification" with one warning rather
 * than failing the build.
 *
 * @param {function} warn  Rollup warn function
 * @returns {Function|null} an instantiated cssnano plugin, or null
 */
let cachedCssnano;

function getHostCssnano(warn) {
  if (cachedCssnano !== undefined) return cachedCssnano;

  try {
    const cssnano = require(require.resolve('cssnano', { paths: [CWD] }));

    cachedCssnano = cssnano({ preset: 'default' });
  } catch (_) {
    warn(
      '[clay-vite-vue2] --minify was requested but "cssnano" is not installed — ' +
      'Kiln plugin CSS will ship unminified. Run: npm install -D cssnano'
    );
    cachedCssnano = null;
  }

  return cachedCssnano;
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
 *   4. Accumulates raw CSS; every non-empty <style> block is delivered ONLY via
 *      public/css/_kiln-plugins.css, written on closeBundle (see the CSS
 *      accumulation note below) — matching the legacy `clay compile` pipeline's
 *      @nymag/vueify + extract-css behaviour, which also delivers Kiln plugin
 *      styles solely via that file (never inlined into the JS bundle). There is
 *      no runtime injection: a site linking _kiln-plugins.css (as
 *      services/resolve-media.js does) got Kiln plugin CSS applied twice under
 *      earlier claycli versions — once via that linked file, once via a
 *      runtime-injected <style> element racing it for cascade position — which
 *      inverted which rule won depending on unrelated timing.
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
 * In two-pass mode (kilnSplit:false), two instances of this plugin exist —
 * one for the view pass and one for the kiln pass (see baseViteConfig()'s
 * four call sites in lib/cmd/vite/scripts.js) — and both write the same
 * KILN_CSS_DEST file in their closeBundle hook. `cssByFile` is therefore a
 * MODULE-level map, not a per-instance closure variable: every instance in
 * the same process records into the one shared map, and the writes are
 * queued one after another, so whichever closeBundle runs last writes the
 * complete content. In practice only kiln-pass .vue files have <style>
 * blocks today, so only one instance ever has anything to contribute, but
 * this is not order- or timing-dependent if that changes.
 *
 * The file is written in path order (see kilnCssContent()), not in the
 * order transforms finished, so identical source gives an identical file.
 *
 * The map persists for the life of the process, which matters for
 * `clay vite --watch`: Rollup's watcher keeps the SAME plugin instances
 * alive across every rebuild, and a rebuilt .vue file replaces its own entry.
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
 * When `minify` is set, appends cssnano to a LOCAL copy of the resolved
 * plugin array (never mutating the cached chain — resolution is cached
 * per-process in getHostPostcssChain, and minify is a per-build setting) so
 * `--minify`/CLAYCLI_COMPILE_MINIFIED gets the same cssnano pass component
 * CSS already gets (lib/cmd/vite/styles.js) and Kiln plugin CSS got under
 * the legacy `clay compile` pipeline (@nymag/vueify appends cssnano when
 * NODE_ENV=production).
 *
 * @param {string} source
 * @param {string} filename
 * @param {function} warn  Rollup warn function
 * @param {boolean} [minify]
 * @returns {Promise<string>}
 */
async function runHostPostcss(source, filename, warn, minify) {
  const chain = getHostPostcssChain();

  if (!chain || chain.plugins.length === 0) return source;

  const cssnano = minify ? getHostCssnano(warn) : null;
  const plugins = cssnano ? chain.plugins.concat(cssnano) : chain.plugins;

  try {
    const result = await chain.postcss(plugins).process(source, {
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
/**
 * The styles step's Lightning CSS compiler, for Kiln plugin <style> blocks:
 * the same nesting, design tokens, browser targets and minification as the
 * styleguide CSS. Null when stylesConfig keeps the deprecated PostCSS
 * pipeline, which runs the host's PostCSS chain as before.
 *
 * Cached per minify setting.
 *
 * @param {boolean} minify
 * @returns {object|null} compiler from createLightningCompiler()
 */
const lightningCompilers = new Map();

function getLightningCompiler(minify) {
  if (!lightningCompilers.has(minify)) {
    const config = resolveStylesConfig(getConfigValue, { minify });

    lightningCompilers.set(minify, config.pipeline === 'postcss' ? null : createLightningCompiler({
      root: CWD,
      config,
      variables: {
        'asset-host': (process.env.CLAYCLI_COMPILE_ASSET_HOST || '').replace(/\/$/, ''),
        'asset-path': process.env.CLAYCLI_COMPILE_ASSET_PATH || '',
      },
      targets: resolveTargets(config, CWD),
    }));
  }

  return lightningCompilers.get(minify);
}

/**
 * Compile a <style> block's CSS (after any preprocessor): Lightning CSS, or
 * the host's PostCSS chain under the deprecated PostCSS pipeline.
 *
 * Invalid CSS fails the build, as it does for styleguide CSS.
 *
 * @param {string}   css
 * @param {string}   filename  the .vue file
 * @param {object}   report    { warn, error } Rollup functions
 * @param {boolean}  minify
 * @returns {Promise<string>}
 */
async function compileStyleCss(css, filename, { warn, error }, minify) {
  const compiler = getLightningCompiler(!!(minify || process.env.CLAYCLI_COMPILE_MINIFIED));

  if (!compiler) return runHostPostcss(css, filename, warn, minify);

  let result;

  try {
    result = compiler.compileText(css, filename);
  } catch (e) {
    error(`[clay-vite-vue2] Lightning CSS failed for ${filename}: ${e.message}`);
    return css;
  }
  if (result.errors.length) {
    error(`[clay-vite-vue2] Invalid CSS in ${filename}: ${result.errors.map(e => `${e.line}:${e.column}: ${e.message}`).join('; ')}`);
  }

  return result.css;
}

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
      (err, res) => err ? reject(err) : resolve(res.css.toString())
    );
  });
}

function renderLess(source, filename, less) {
  return new Promise((resolve, reject) => {
    less.render(source, { filename }, (err, out) => err ? reject(err) : resolve(out.css));
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
 * Compile each <style> block. Raw CSS strings are pushed to `rawCss` for
 * delivery via the kiln plugin CSS file (see the module doc comment above —
 * there is no runtime injection; `rawCss` is the only output of this
 * function).
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
 * @param {string[]} ctx.rawCss       accumulated raw CSS (mutated)
 * @param {function} ctx.warn         Rollup warn function
 * @param {function} ctx.error        Rollup error function (throws, halts the build)
 * @param {boolean}  [ctx.minify]     append cssnano to the resolved chain
 */
async function processStyleBlocks(ctx) {
  const { descriptor, compilerUtils, id, scopeId, rawCss, warn, error, minify } = ctx;

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

    let css = await compileStyleCss(preprocessed, id, { warn, error }, minify);

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

    rawCss.push(css);
  }
}

function viteVue2Plugin(options = {}) {
  const minify = options.minify === true;

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

      const isProduction = minify || !!process.env.CLAYCLI_COMPILE_MINIFIED;
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
      await processStyleBlocks({ descriptor, compilerUtils, id, scopeId, rawCss, warn: this.warn.bind(this), error: this.error.bind(this), minify });

      // ── Scope id (independent of whether a <template> block exists) ────────
      applyScopeId(hasScopedStyles, scopeId, parts);

      // ── ESM export ─────────────────────────────────────────────────────────
      parts.push('export default __sfc__;');

      if (rawCss.length) cssByFile.set(id, rawCss);
      else cssByFile.delete(id);

      return { code: parts.join('\n'), map: null };
    },

    // This plugin only participates in the `js` step's Vite/Rollup build
    // (buildPlugins() is only assembled for the JS pass — see
    // lib/cmd/vite/scripts.js), so public/css/_kiln-plugins.css is owned
    // entirely by `js`: a `clay vite --only styles` (or any --only that
    // excludes `js`) run does not touch this file at all, and a run
    // including `js` always rewrites it wholesale from whatever .vue files
    // it traverses. A pipeline that post-processes public/css (e.g. an
    // asset-hashing step) must run after the LAST claycli invocation that
    // includes `js`, or its changes to this specific file will be
    // overwritten on the next one.
    closeBundle() {
      // The content is read when this write's turn comes, so the last write
      // has every block both passes collected.
      cssWriteQueue = cssWriteQueue.then(async () => {
        const { css, blocks } = kilnCssContent();

        if (blocks === 0) return;

        try {
          await fsExtra.ensureDir(path.dirname(KILN_CSS_DEST));
          await fsExtra.writeFile(KILN_CSS_DEST, css, 'utf8');
          console.log(`[clay vite] wrote ${path.relative(CWD, KILN_CSS_DEST)} (${blocks} style block(s))`);
        } catch (e) {
          console.error('[clay-vite-vue2] Failed to write _kiln-plugins.css:', e.message);
        }
      });

      return cssWriteQueue;
    },
  };
}

/**
 * Scope ID for a Vue SFC's file path, via the SAME `hash-sum` algorithm
 * `@nymag/vueify`'s compiler.js uses (`genId(file) = hash(file)`,
 * lib/gen-id.js in that package) for the legacy `clay compile` pipeline.
 *
 * This MUST match byte-for-byte, not just be internally stable within this
 * pipeline: a site running the staged Vite rollout (`CLAYCLI_VITE_SITES=
 * <slugs>`) runs `clay vite` and `clay compile` in the same build
 * (`build:both`), and both write public/css/_kiln-plugins.css — whichever
 * runs last wins on disk. If the two pipelines compute DIFFERENT scope ids
 * for the same file, the scoped-style `[data-v-XXXXXXXX]` selectors in
 * whichever file ends up on disk never match the `data-v-XXXXXXXX`
 * attribute the OTHER pipeline's mounted Vue components actually carry —
 * every `<style scoped>` rule in every Kiln plugin silently fails to match,
 * with no error anywhere.
 *
 * This was previously a hand-rolled djb2 hash, self-consistent within this
 * plugin but never actually verified against vueify's own algorithm — the
 * two never matched. It went unnoticed because claycli's OLD runtime
 * <style> injection (removed as of the "stop double-applying" fix) happened
 * to deliver THIS pipeline's own (djb2-hashed, self-consistent) CSS
 * directly into <head>, independent of whatever ended up in the linked
 * file. Removing that injection removed the accidental compensation along
 * with the double-delivery bug it was fixing, surfacing this pre-existing
 * cross-pipeline mismatch for the first time.
 *
 * @param {string} filepath
 * @returns {string}
 */
function computeScopeId(filepath) {
  return hashSum(filepath);
}

module.exports = viteVue2Plugin;

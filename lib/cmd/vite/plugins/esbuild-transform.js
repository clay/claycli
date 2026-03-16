'use strict';

const esbuild = require('esbuild');

/**
 * Rollup plugin that uses esbuild for two purposes:
 *
 *   1. transform hook — replaces @rollup/plugin-replace.
 *      Runs esbuild.transform() on every source module to substitute
 *      compile-time defines (process.env.NODE_ENV, __filename, __dirname,
 *      process.browser, global→globalThis, and any user-defined mappings
 *      from rollupConfig.define).  esbuild's define is identifier-aware —
 *      it does not replace inside string literals, path segments, or function
 *      parameter names, so it is strictly safer than regex-based replace.
 *
 *   2. renderChunk hook — replaces the post-build minifyWithEsbuild() pass.
 *      When options.minify is true, minifies each Rollup output chunk in
 *      memory (via Rollup's renderChunk hook) so no disk read/write cycle
 *      is needed after the build finishes.  This also makes minification
 *      work correctly in watch mode, where the old post-build pass was
 *      never called.
 *
 * @rollup/plugin-commonjs is still required for module-graph resolution
 * (converting require() calls into import statements that Rollup can trace).
 * This plugin runs before commonjs in the plugin order so that the define
 * substitutions are applied to source code before commonjs transforms it.
 *
 * @param {object} [options]
 * @param {boolean} [options.minify=false]
 * @param {object}  [options.define={}]   - Extra define map merged on top of defaults
 * @returns {object} Rollup plugin
 */
function esbuildTransformPlugin(options = {}) {
  const NODE_ENV = process.env.NODE_ENV || 'development';

  // Builtin defines — mirrors what @rollup/plugin-replace was providing.
  // esbuild replace is identifier-scoped so it never corrupts string literals.
  const builtinDefines = {
    'process.env.NODE_ENV': JSON.stringify(NODE_ENV),
    'process.browser':      'true',
    'process.version':      '""',
    'process.versions':     '{}',
    __filename:             '""',
    __dirname:              '"/"',
    global:                 'globalThis',
  };

  // Merge user-defined replacements (e.g. DS → window.DS) on top of builtins.
  // User values override builtins when the same key appears in both.
  const defineMap = Object.assign({}, builtinDefines, options.define || {});

  return {
    name: 'clay-esbuild-transform',

    // --- define substitution -------------------------------------------------
    // Runs on every .js/.cjs/.mjs source module before @rollup/plugin-commonjs.
    // Skips virtual modules (\0-prefixed) since those are already synthesised
    // by other plugins (browser-compat stubs, missing-module stubs, etc.).
    async transform(code, id) {
      if (id.startsWith('\0')) return null;
      if (!/\.(js|cjs|mjs)$/.test(id)) return null;

      try {
        const result = await esbuild.transform(code, {
          loader:     'js',
          sourcefile: id,
          sourcemap:  'external',
          define:     defineMap,
          // Do NOT set format:'esm' here — esbuild.transform with format:'esm'
          // wraps CJS in __commonJS() helpers that leave require() calls intact
          // inside factory functions, breaking @rollup/plugin-commonjs which
          // needs to see bare require() calls at the module's top scope.
          // Setting no format leaves the module format as-is (CJS stays CJS)
          // so commonjs can properly convert it.
        });

        if (!result.code) return null;

        return {
          code: result.code,
          map:  result.map || null,
        };
      } catch (e) {
        // Non-fatal: if esbuild can't parse a module (e.g. edge-case syntax),
        // fall through to the next plugin rather than hard-erroring.
        this.warn(`[esbuild-transform] skipping ${id}: ${e.message}`);
        return null;
      }
    },

    // --- in-memory minification ----------------------------------------------
    // Runs after Rollup has assembled each output chunk.  No disk I/O needed.
    async renderChunk(code, chunk) {
      if (!options.minify) return null;

      const result = await esbuild.transform(code, {
        minify:    true,
        sourcefile: chunk.fileName,
        sourcemap: 'external',
      });

      return {
        code: result.code,
        map:  result.map || null,
      };
    },
  };
}

module.exports = esbuildTransformPlugin;

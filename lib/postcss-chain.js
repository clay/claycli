'use strict';

/**
 * Shared resolution + validation for the PostCSS chain applied to Kiln plugin
 * / Vue 2 SFC `<style>` blocks, used by BOTH build pipelines:
 *   - `clay vite`'s Vue 2 SFC plugin    (lib/cmd/vite/plugins/vue2.js)
 *   - `clay compile`'s vueify pipeline  (lib/cmd/compile/scripts.js)
 *
 * ── Why this exists as one module instead of two copies ─────────────────────
 *
 * Both pipelines write the SAME output file (public/css/_kiln-plugins.css) for
 * a site running the staged Vite rollout (`CLAYCLI_VITE_SITES=<slugs>`, which
 * runs both `clay compile` and `clay vite`). Two independent implementations
 * of "resolve the Kiln-plugin PostCSS chain" silently drifted apart — this
 * module is the single source of truth so that drift can't recur.
 *
 * ── Why the host tree, and why we never fall back to claycli's own copies ──
 *
 * `@nymag/vueify` (the legacy Browserify Vue-style compiler) hard-pins
 * `postcss@^7` and runs whatever plugin array it's handed through its OWN
 * internal postcss instance (see `@nymag/vueify/lib/style-rewriter.js`).
 * Handing it claycli's bundled PostCSS 8 plugins does not degrade gracefully —
 * it throws `PostCSS plugin X requires PostCSS 8` the moment that plugin
 * runs, verified empirically against a real postcss@7 host. So a host without
 * a complete chain cannot be "fixed" by substituting claycli's own tree: for
 * `clay compile` specifically, that substitution is a guaranteed crash.
 *
 * The host project therefore OWNS this toolchain. This module's job is to
 * validate what the host has and say exactly what's missing or incompatible —
 * never to silently drop it (today's behavior, which is how a real site can
 * ship with `postcss-mixins` silently absent for months) and never to paper
 * over it with a different major (which crashes under `clay compile`).
 *
 * ── Compatibility table ──────────────────────────────────────────────────────
 *
 * Verified by inspecting each plugin's declared `peerDependencies.postcss`
 * across its published majors: every major at or below the postcss7 ceiling
 * below declares NO postcss peerDependency (built in the postcss7 era, works
 * against either major in practice); every major past it declares a strict
 * `postcss@^8.x` peerDependency. `postcss-import` never developed a hard
 * split — the same major line (12.x) works against either host major — so it
 * has no ceiling entry and is only checked for presence.
 */

const KILN_CHAIN_PLUGIN_NAMES = [
  'postcss-import',
  'autoprefixer',
  'postcss-mixins',
  'postcss-nested',
  'postcss-simple-vars',
];

// Highest major of each plugin that still targets the postcss@7 API.
// One major above this requires postcss@8.
const POSTCSS7_MAX_MAJOR = {
  autoprefixer: 9,
  'postcss-mixins': 6,
  'postcss-nested': 4,
  'postcss-simple-vars': 5,
};

// Recommended install range per plugin, by resolved postcss host major.
// These are claycli's own known-good versions for postcss8 (see
// package.json), and the last postcss7-era majors for postcss7.
const RECOMMENDED_VERSION = {
  7: {
    'postcss-import': '^12.0.0',
    autoprefixer: '^9.0.0',
    'postcss-mixins': '^6.0.0',
    'postcss-nested': '^4.0.0',
    'postcss-simple-vars': '^5.0.0',
  },
  8: {
    'postcss-import': '^12.0.0',
    autoprefixer: '^10.0.0',
    'postcss-mixins': '^9.0.0',
    'postcss-nested': '^6.0.0',
    'postcss-simple-vars': '^7.0.0',
  },
};

/**
 * Resolve a named module from a specific set of lookup paths.
 *
 * @param {string} name
 * @param {string[]} paths
 * @returns {*} the module's export, or null if unresolvable
 */
function resolveFrom(name, paths) {
  try {
    return require(require.resolve(name, { paths }));
  } catch (_) {
    return null;
  }
}

/**
 * Resolve a named module's own declared version from a specific set of
 * lookup paths.
 *
 * @param {string} name
 * @param {string[]} paths
 * @returns {string|null}
 */
function resolvedVersionFrom(name, paths) {
  try {
    return require(require.resolve(`${name}/package.json`, { paths })).version;
  } catch (_) {
    return null;
  }
}

/**
 * @param {string} version
 * @returns {number|null}
 */
function majorOf(version) {
  if (!version) return null;
  const n = parseInt(String(version).split('.')[0], 10);

  return Number.isNaN(n) ? null : n;
}

/**
 * Default issue reporter: one line per problem, plus one summary line.
 * Callers may pass their own `onIssue`/`onResolved` to integrate with a
 * larger build-summary instead of printing immediately.
 *
 * @param {string} message
 */
function defaultOnIssue(message) {
  console.warn(message);
}

function reportMissingPostcss(onIssue) {
  onIssue(
    '[clay] postcss is not installed in this project — Kiln plugin <style> ' +
    'blocks will ship unprocessed (no nesting, mixins, or variable ' +
    'interpolation). Install postcss and the Kiln-plugin PostCSS chain: ' +
    `npm i -D postcss@^8 ${KILN_CHAIN_PLUGIN_NAMES
      .map(n => `${n}@${RECOMMENDED_VERSION[8][n]}`)
      .join(' ')}`
  );
}

/**
 * Whether a resolved plugin major is incompatible with the resolved postcss
 * major, per the POSTCSS7_MAX_MAJOR ceiling table.
 *
 * @param {string} name
 * @param {number|null} pluginMajor
 * @param {number|null} postcssMajor
 * @returns {boolean}
 */
function isIncompatibleMajor(name, pluginMajor, postcssMajor) {
  const ceiling = POSTCSS7_MAX_MAJOR[name];

  if (!ceiling || postcssMajor == null || pluginMajor == null) return false;

  const requiresPostcss8 = pluginMajor > ceiling;

  return postcssMajor <= 7 && requiresPostcss8 || postcssMajor >= 8 && pluginMajor <= ceiling;
}

/**
 * Resolve and validate a single Kiln-chain plugin. Reports (via onIssue) and
 * returns null for anything missing or incompatible; the caller excludes it
 * from the chain and continues with whatever else resolved cleanly.
 *
 * @param {string} name
 * @param {object} ctx
 * @returns {{mod: *, version: string}|null}
 */
function resolveOnePlugin(name, ctx) {
  const { paths, cwd, postcssVersion, postcssMajor, recommended, onIssue } = ctx;
  const mod = resolveFrom(name, paths);
  const version = resolvedVersionFrom(name, paths);
  const recommendedRange = recommended && recommended[name];
  const installHint = recommendedRange ? ` Install: npm i -D ${name}@${recommendedRange}` : '';

  if (!mod) {
    onIssue(
      `[clay] ${name} is required for the Kiln-plugin PostCSS chain but is ` +
      `not installed (postcss@${postcssVersion} resolved from ${cwd}). ` +
      `Kiln plugin styles will build without it — continuing.${installHint}`
    );
    return null;
  }

  if (isIncompatibleMajor(name, majorOf(version), postcssMajor)) {
    onIssue(
      `[clay] ${name}@${version} is incompatible with the resolved ` +
      `postcss@${postcssVersion} (both resolved from ${cwd}) and would ` +
      'throw the first time a Kiln plugin style is compiled. Kiln plugin ' +
      `styles will build without it — continuing.${installHint}`
    );
    return null;
  }

  return { mod, version };
}

/**
 * Resolve postcss + the Kiln-plugin PostCSS chain from ONE tree (the host
 * project's node_modules), instantiated with the given plugin arguments.
 *
 * Never mixes plugin versions across trees, never throws, and never silently
 * drops a problem — every missing or incompatible plugin is reported via
 * `onIssue` with the exact fix, and is simply excluded from the returned
 * chain (matching the existing "best-effort" degrade-gracefully contract:
 * the chain still runs whatever resolved cleanly).
 *
 * @param {object}   [opts]
 * @param {string}   [opts.cwd=process.cwd()]
 * @param {object}   [opts.pluginArgs] - map of plugin name → array of
 *   arguments to invoke it with, e.g. `{ autoprefixer: [autoprefixerOptions] }`.
 *   Plugins not present in this map are invoked with no arguments.
 * @param {function} [opts.onIssue] - called once per missing/incompatible
 *   plugin AND once with postcss itself if it can't be resolved at all, with
 *   a single human-readable message. Defaults to `console.warn`.
 * @returns {{ postcss: Function, plugins: Array, resolved: object } | null}
 *   `resolved` maps plugin name → resolved version string (only for plugins
 *   that made it into the chain). Returns null only when `postcss` itself
 *   cannot be resolved from the host tree — callers should fall back to
 *   passing style source through unprocessed, exactly as when no chain is
 *   available today.
 */
/**
 * Resolve + instantiate every chain plugin that validates cleanly against
 * resolveCtx's postcss major, invoking each with its entry in pluginArgs (or
 * no arguments if absent).
 *
 * @param {object} resolveCtx  see resolveOnePlugin
 * @param {object} pluginArgs  map of plugin name → argument array
 * @returns {{plugins: Array, resolved: object}}
 */
function resolveAllPlugins(resolveCtx, pluginArgs) {
  const plugins = [];
  const resolved = {};

  for (const name of KILN_CHAIN_PLUGIN_NAMES) {
    const result = resolveOnePlugin(name, resolveCtx);

    if (!result) continue;

    const args = pluginArgs[name] || [];
    const instance = typeof result.mod === 'function' ? result.mod(...args) : result.mod;

    plugins.push(instance);
    resolved[name] = result.version;
  }

  return { plugins, resolved };
}

function resolveKilnPostcssChain(opts = {}) {
  const cwd = opts.cwd || process.cwd();
  const pluginArgs = opts.pluginArgs || {};
  const onIssue = opts.onIssue || defaultOnIssue;
  const paths = [cwd];

  const postcss = resolveFrom('postcss', paths);
  const postcssVersion = resolvedVersionFrom('postcss', paths);
  const postcssMajor = majorOf(postcssVersion);

  if (!postcss) {
    reportMissingPostcss(onIssue);
    return null;
  }

  const resolveCtx = {
    paths, cwd, postcssVersion, postcssMajor, onIssue,
    recommended: RECOMMENDED_VERSION[postcssMajor],
  };
  const { plugins, resolved } = resolveAllPlugins(resolveCtx, pluginArgs);

  return { postcss, plugins, resolved };
}

module.exports = {
  KILN_CHAIN_PLUGIN_NAMES,
  resolveKilnPostcssChain,
  // exported for reuse by callers that need one-off resolution outside the
  // Kiln chain (e.g. resolving `postcss` itself for a version check)
  resolveFrom,
  resolvedVersionFrom,
};

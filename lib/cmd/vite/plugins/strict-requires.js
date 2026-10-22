'use strict';

/**
 * Deterministic CommonJS wrapping for @rollup/plugin-commonjs's
 * `strictRequires: 'auto'`.
 *
 * ── The problem ──────────────────────────────────────────────────────────────
 *
 * Under 'auto', commonjs wraps a CommonJS module in a lazy `requireX()`
 * function when it is part of a require() cycle, or when it is only required
 * "conditionally" (inside a function, an `if` branch, the right side of
 * `&&`/`||`, a `try` block, or from a parent that is itself wrapped for that
 * reason).  The second rule is decided when the module's own transform starts,
 * from the require() edges commonjs has seen BY THEN.  Rollup loads modules
 * concurrently, so a module required conditionally by one parent and
 * unconditionally by another is wrapped or not depending on which parent's
 * resolve() finished first.
 *
 * nymag/sites hits this with pyxis-frontend (required inside the
 * services/kiln/index.js init function, and at the top of
 * agora/components/pyxis-input.vue) and js-cookie: identical source gave a
 * different kiln bundle on roughly every other build, and through the content
 * hashes in import specifiers one changed leaf renames every chunk that
 * imports it.
 *
 * ── The fix ──────────────────────────────────────────────────────────────────
 *
 * computeWrappedIds() applies the same two rules to the COMPLETE require
 * graph, so the answer no longer depends on load order:
 *
 *   - a module is wrapped for being "conditional" when every require() of it
 *     is conditional or comes from a parent wrapped for that same reason
 *     (least fixpoint; commonjs's own semantics: "only required in a
 *     potentially conditional way").  An ESM import or import() of it counts
 *     as unconditional: it loads the module as soon as the importer is
 *     parsed (the bootstrap's import() of every component client.js);
 *   - a module is wrapped when it is in a require() cycle.  Cycle wrapping
 *     does not make the module's own requires conditional: commonjs only
 *     learns about the cycle after the module has registered its requires.
 *
 * Measured on nymag/sites, this reproduces what 'auto' produces for every
 * module (107 in the view pass, 221 in the kiln pass) except the racy ones,
 * so it changes nothing that is not already changing from build to build.
 *
 * createStrictRequiresCheck() runs each build pass with 'auto' as before and
 * compares 'auto''s decisions with computeWrappedIds() at buildEnd.  When they
 * match, the pass continues as usual.  When they differ, the pass is aborted
 * before any output is generated and scripts.js re-runs it with the computed
 * set as an explicit `strictRequires` list (toStrictRequiresOption()), which
 * commonjs applies without any order-dependent analysis.  Both paths emit the
 * same bytes for the same set, so the output is a function of the source only.
 *
 * @module
 */

const WRAPPED = 'withRequireFunction';

/**
 * Error thrown from renderStart to abort a pass whose 'auto' decisions
 * differed from the complete-graph ones.  scripts.js catches it and rebuilds.
 */
class StrictRequiresMismatch extends Error {
  /**
   * @param {string[]} wrappedIds   the ids to wrap on the rebuild (sorted)
   * @param {object}   diff         { wrappedOnlyByAuto, wrappedOnlyByGraph }
   */
  constructor(wrappedIds, diff) {
    super('[clay vite] commonjs wrapped modules differently than the complete require graph says; rebuilding');
    this.name = 'StrictRequiresMismatch';
    this.code = 'CLAY_STRICT_REQUIRES_MISMATCH';
    this.wrappedIds = wrappedIds;
    this.diff = diff;
  }
}

const ES_IMPORT_SUFFIX = '?commonjs-es-import';

/**
 * Ids `id` imports with ESM `import`/`import()` rather than through a
 * converted require(): its imported ids minus the ones commonjs put there for
 * its requires (a wrapped require is imported under the target's own id), plus
 * the target of each `?commonjs-es-import` bridge, which commonjs inserts
 * between an ES importer and a wrapped CommonJS module.
 *
 * @param {object} mod  `{ id, commonjs, importedIds, dynamicallyImportedIds }`
 * @returns {string[]}
 */
function esmImportTargets(mod) {
  const requires = mod.commonjs && mod.commonjs.requires || [];
  const required = new Set(requires.map(r => r.resolved && r.resolved.id));
  const target = imported => {
    if (!imported.startsWith('\0')) return required.has(imported) ? null : imported;

    return imported.endsWith(ES_IMPORT_SUFFIX) ? imported.slice(1, -ES_IMPORT_SUFFIX.length) : null;
  };

  return [...mod.importedIds || [], ...mod.dynamicallyImportedIds || []].map(target).filter(Boolean);
}

/**
 * Index the require() edges of one pass's modules, and which modules some
 * module imports with ESM.
 *
 * @param {Iterable<object>} modules  `{ id, commonjs, importedIds,
 *   dynamicallyImportedIds }` per module, where `commonjs` is the module's
 *   `meta.commonjs` (undefined when commonjs did not process it)
 * @returns {{initialType: Map, children: Map, parents: Map, esmImported: Set}}
 */
function indexRequireGraph(modules) {
  const initialType = new Map();
  const children = new Map();
  const parents = new Map();
  const esmImported = new Set();
  const addEdge = (parent, child, isConditional) => {
    if (!children.has(parent)) children.set(parent, new Set());
    children.get(parent).add(child);
    if (!parents.has(child)) parents.set(child, []);
    parents.get(child).push({ parent, isConditional: !!isConditional });
  };

  for (const mod of modules) {
    if (!mod.id.startsWith('\0')) esmImportTargets(mod).forEach(target => esmImported.add(target));
    if (!mod.commonjs) continue;
    initialType.set(mod.id, mod.commonjs.initialCommonJSType);
    for (const { resolved, isConditional } of mod.commonjs.requires || []) {
      if (resolved && resolved.id) addEdge(mod.id, resolved.id, isConditional);
    }
  }

  return { initialType, children, parents, esmImported };
}

/**
 * Modules wrapped before they register their own requires: the ones commonjs
 * forces (initial type already WRAPPED) and the conditional-only ones, as a
 * least fixpoint (a require from such a module counts as conditional).  An
 * ESM import counts as an unconditional edge: it loads the module the moment
 * its importer is parsed, before any conditional require() can be seen.
 *
 * @param {{initialType: Map, parents: Map, esmImported: Set}} graph
 * @returns {Set<string>}
 */
function conditionallyWrappedIds({ initialType, parents, esmImported }) {
  const wrapped = new Set([...initialType].filter(([, type]) => type === WRAPPED).map(([id]) => id));
  const onlyConditional = child => !esmImported.has(child) && parents.get(child)
    .every(({ parent, isConditional }) => isConditional || wrapped.has(parent));

  let changed = true;

  while (changed) {
    changed = false;
    for (const child of parents.keys()) {
      if (initialType.get(child) === true && !wrapped.has(child) && onlyConditional(child)) {
        wrapped.add(child);
        changed = true;
      }
    }
  }

  return wrapped;
}

/**
 * Compute which CommonJS modules commonjs should wrap, from the complete
 * module graph of one build pass.  Pure function; see the module doc.
 *
 * @param {Iterable<object>} modules  as for indexRequireGraph()
 * @returns {Set<string>} ids of the modules to wrap
 */
function computeWrappedIds(modules) {
  const graph = indexRequireGraph(modules);
  const wrapped = conditionallyWrappedIds(graph);

  for (const [id, type] of graph.initialType) {
    if (type === true && isInRequireCycle(id, graph.children)) wrapped.add(id);
  }

  return wrapped;
}

/**
 * True when `id` can reach itself through require() edges (commonjs's
 * isCyclic(), over the complete graph).
 *
 * @param {string} id
 * @param {Map<string, Set<string>>} children
 * @returns {boolean}
 */
function isInRequireCycle(id, children) {
  const seen = new Set(children.get(id) || []);

  for (const dep of seen) {
    if (dep === id) return true;
    for (const next of children.get(dep) || []) seen.add(next);
  }

  return false;
}

/**
 * Turn a set of module ids into a value for commonjs's `strictRequires`
 * option.  commonjs feeds it to createFilter(), which treats strings as
 * picomatch globs, so ids go in as one anchored, escaped RegExp instead: a
 * path containing `(`, `[`, `+` or `@` must match itself, not a pattern.
 * An empty set becomes `false` (wrap nothing): an empty array would mean
 * "no filter" to createFilter and wrap everything.
 *
 * @param {Iterable<string>} ids
 * @returns {RegExp[]|false}
 */
function toStrictRequiresOption(ids) {
  const list = [...ids].sort();

  if (!list.length) return false;

  const escape = s => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

  return [new RegExp(`^(?:${list.map(escape).join('|')})$`)];
}

function collectModules(ctx) {
  return [...ctx.getModuleIds()].map(id => {
    const info = ctx.getModuleInfo(id) || {};

    return {
      id,
      commonjs:               info.meta && info.meta.commonjs,
      importedIds:            info.importedIds || [],
      dynamicallyImportedIds: info.dynamicallyImportedIds || [],
    };
  });
}

function actualWrappedIds(modules) {
  return new Set(modules.filter(m => m.commonjs && m.commonjs.isCommonJS === WRAPPED).map(m => m.id));
}

function difference(a, b) {
  return [...a].filter(x => !b.has(x)).sort();
}

/**
 * Explicit mode: fail the pass when commonjs did not wrap exactly the listed
 * modules (the list did not take, and rebuilding again would not help).
 *
 * @param {object}   ctx       Rollup plugin context
 * @param {Set<string>} actual
 * @param {string[]} expected
 */
function checkExplicit(ctx, actual, expected) {
  const want = new Set(expected);
  const extra = difference(actual, want);
  const missing = difference(want, actual);

  if (extra.length || missing.length) {
    ctx.error(
      '[clay vite] commonjs did not apply the explicit strictRequires list ' +
      `(unexpectedly wrapped: ${extra.join(', ') || 'none'}; not wrapped: ${missing.join(', ') || 'none'}).`
    );
  }
}

/**
 * Auto mode: compare 'auto''s decisions with the complete graph's.
 *
 * @param {object[]} modules
 * @returns {StrictRequiresMismatch|null}
 */
function compareWithGraph(modules) {
  const actual = actualWrappedIds(modules);
  const graph = computeWrappedIds(modules);
  const wrappedOnlyByAuto = difference(actual, graph);
  const wrappedOnlyByGraph = difference(graph, actual);

  if (!wrappedOnlyByAuto.length && !wrappedOnlyByGraph.length) return null;

  return new StrictRequiresMismatch([...graph].sort(), { wrappedOnlyByAuto, wrappedOnlyByGraph });
}

/**
 * Plugin that checks one build pass's commonjs wrapping.
 *
 * mode 'auto':     compare 'auto''s decisions with computeWrappedIds(); on a
 *                  difference, throw StrictRequiresMismatch from renderStart
 *                  (after the module graph is complete, before any chunk is
 *                  rendered or written).
 * mode 'explicit': the pass ran with toStrictRequiresOption(expected); fail
 *                  the build if commonjs wrapped anything else (that would
 *                  mean the explicit list did not take, and retrying again
 *                  would not help).
 *
 * @param {object}   opts
 * @param {'auto'|'explicit'} opts.mode
 * @param {string[]} [opts.expected]  explicit mode: the ids passed to commonjs
 * @param {function(StrictRequiresMismatch): void} [opts.onMismatch]  auto mode:
 *   called at buildEnd when the pass is about to be aborted
 * @returns {object} Rollup plugin
 */
function createStrictRequiresCheck({ mode, expected = [], onMismatch }) {
  let mismatch = null;

  return {
    name: 'clay-vite-strict-requires-check',

    buildEnd(error) {
      mismatch = null;
      if (error) return;

      const modules = collectModules(this);

      if (mode === 'explicit') {
        checkExplicit(this, actualWrappedIds(modules), expected);
        return;
      }

      mismatch = compareWithGraph(modules);
      if (mismatch && onMismatch) onMismatch(mismatch);
    },

    renderStart() {
      if (mismatch) throw mismatch;
    },
  };
}

module.exports = {
  WRAPPED,
  StrictRequiresMismatch,
  computeWrappedIds,
  toStrictRequiresOption,
  createStrictRequiresCheck,
};

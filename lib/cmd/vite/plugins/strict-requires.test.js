/* eslint-env jest */
'use strict';

const {
  WRAPPED,
  StrictRequiresMismatch,
  computeWrappedIds,
  toStrictRequiresOption,
  createStrictRequiresCheck,
} = require('./strict-requires');

/**
 * Build a pass's module list from a compact description.
 *
 * @param {object} spec  id → { type, requires: [[childId, isConditional]],
 *   imports: [...ids], dynamic: [...ids], wrapped: boolean }
 * @returns {object[]}
 */
function graph(spec) {
  return Object.entries(spec).map(([id, m]) => ({
    id,
    commonjs: m.type === undefined ? undefined : {
      initialCommonJSType: m.type,
      isCommonJS: m.wrapped ? WRAPPED : m.type,
      requires: (m.requires || []).map(([child, isConditional]) => ({ resolved: { id: child }, isConditional })),
    },
    importedIds: m.imports || [],
    dynamicallyImportedIds: m.dynamic || [],
  }));
}

const sorted = set => [...set].sort();

describe('computeWrappedIds', () => {
  it('leaves a module required unconditionally alone', () => {
    expect(sorted(computeWrappedIds(graph({
      '/p.js': { type: true, requires: [['/x.js', false]] },
      '/x.js': { type: true },
    })))).toEqual([]);
  });

  it('wraps a module that is only required conditionally, and what it requires', () => {
    expect(sorted(computeWrappedIds(graph({
      '/p.js': { type: true, requires: [['/x.js', true]] },
      '/x.js': { type: true, requires: [['/y.js', false]] },
      '/y.js': { type: true },
    })))).toEqual(['/x.js', '/y.js']);
  });

  it('leaves a module required both ways alone, whichever parent comes first', () => {
    const mixed = {
      '/early.js': { type: true, requires: [['/x.js', true]] },
      '/late.js': { type: true, requires: [['/x.js', false]] },
      '/x.js': { type: true },
    };

    expect(sorted(computeWrappedIds(graph(mixed)))).toEqual([]);
    expect(sorted(computeWrappedIds(graph(mixed).reverse()))).toEqual([]);
  });

  it('counts an ESM import or import() as an unconditional edge', () => {
    expect(sorted(computeWrappedIds(graph({
      '/entry.js': { type: false, dynamic: ['/x.js'], imports: ['/y.js'] },
      '/p.js': { type: true, requires: [['/x.js', true], ['/y.js', true]] },
      '/x.js': { type: true },
      '/y.js': { type: true },
    })))).toEqual([]);
  });

  it('counts the target of a ?commonjs-es-import bridge as ESM-imported', () => {
    expect(sorted(computeWrappedIds(graph({
      '/entry.js': { type: false, imports: ['\0/x.js?commonjs-es-import'] },
      '/p.js': { type: true, requires: [['/x.js', true]] },
      '/x.js': { type: true },
    })))).toEqual([]);
  });

  it('does not count a wrapped require (imported under the target\'s own id) as ESM', () => {
    expect(sorted(computeWrappedIds(graph({
      '/p.js': { type: true, requires: [['/x.js', true]], imports: ['/x.js'] },
      '/x.js': { type: true },
    })))).toEqual(['/x.js']);
  });

  it('ignores imports made by virtual modules', () => {
    expect(sorted(computeWrappedIds(graph({
      '\0/x.js?commonjs-proxy': { imports: ['/x.js'] },
      '/p.js': { type: true, requires: [['/x.js', true]], imports: ['\0/x.js?commonjs-proxy'] },
      '/x.js': { type: true },
    })))).toEqual(['/x.js']);
  });

  it('wraps a require() cycle without making its members\' requires conditional', () => {
    expect(sorted(computeWrappedIds(graph({
      '/entry.js': { type: true, requires: [['/a.js', false]] },
      '/a.js': { type: true, requires: [['/b.js', false], ['/leaf.js', false]] },
      '/b.js': { type: true, requires: [['/a.js', false]] },
      '/leaf.js': { type: true },
    })))).toEqual(['/a.js', '/b.js']);
  });

  it('never wraps an ES module, and treats a module commonjs forced as wrapped', () => {
    expect(sorted(computeWrappedIds(graph({
      '/p.js': { type: true, requires: [['/esm.js', true], ['/forced.js', false]] },
      '/esm.js': { type: false },
      '/forced.js': { type: WRAPPED, requires: [['/child.js', false]] },
      '/child.js': { type: true },
      '/skipped.js': {},
    })))).toEqual(['/child.js', '/forced.js']);
  });
});

describe('toStrictRequiresOption', () => {
  it('is false (wrap nothing) for no ids, not an empty filter that matches everything', () => {
    expect(toStrictRequiresOption([])).toBe(false);
  });

  it('matches exactly the given ids, including glob and regex characters', () => {
    const [re] = toStrictRequiresOption(['/n/@scope/a+b/(x)/[y].js', '/n/plain.js']);

    expect(re.test('/n/@scope/a+b/(x)/[y].js')).toBe(true);
    expect(re.test('/n/plain.js')).toBe(true);
    expect(re.test('/n/plain.jsx')).toBe(false);
    expect(re.test('/m/n/plain.js')).toBe(false);
    expect(re.test('/n/@scope/aab/(x)/[y].js')).toBe(false);
  });
});

describe('createStrictRequiresCheck', () => {
  const ctxFor = modules => ({
    getModuleIds: () => modules.map(m => m.id)[Symbol.iterator](),
    getModuleInfo: id => {
      const m = modules.find(x => x.id === id);

      return { meta: { commonjs: m.commonjs }, importedIds: m.importedIds, dynamicallyImportedIds: m.dynamicallyImportedIds };
    },
    error: jest.fn(msg => { throw new Error(msg); }),
  });
  const racy = wrappedByAuto => graph({
    '/early.js': { type: true, requires: [['/x.js', true]] },
    '/late.js': { type: true, requires: [['/x.js', false]] },
    '/x.js': { type: true, wrapped: wrappedByAuto },
  });

  it('lets the pass continue when auto agrees with the graph', () => {
    const onMismatch = jest.fn();
    const check = createStrictRequiresCheck({ mode: 'auto', onMismatch });

    check.buildEnd.call(ctxFor(racy(false)));

    expect(() => check.renderStart()).not.toThrow();
    expect(onMismatch).not.toHaveBeenCalled();
  });

  it('aborts at renderStart with the graph\'s list when auto raced', () => {
    const onMismatch = jest.fn();
    const check = createStrictRequiresCheck({ mode: 'auto', onMismatch });

    check.buildEnd.call(ctxFor(racy(true)));

    expect(onMismatch).toHaveBeenCalledTimes(1);

    let thrown;

    try {
      check.renderStart();
    } catch (e) {
      thrown = e;
    }

    expect(thrown).toBeInstanceOf(StrictRequiresMismatch);
    expect(thrown.wrappedIds).toEqual([]);
    expect(thrown.diff).toEqual({ wrappedOnlyByAuto: ['/x.js'], wrappedOnlyByGraph: [] });
  });

  it('does nothing when the build already failed', () => {
    const check = createStrictRequiresCheck({ mode: 'auto' });

    check.buildEnd.call(ctxFor(racy(true)), new Error('boom'));

    expect(() => check.renderStart()).not.toThrow();
  });

  it('fails an explicit pass whose wrapping is not exactly the list', () => {
    const ok = createStrictRequiresCheck({ mode: 'explicit', expected: ['/x.js'] });
    const bad = createStrictRequiresCheck({ mode: 'explicit', expected: [] });

    expect(() => ok.buildEnd.call(ctxFor(racy(true)))).not.toThrow();
    expect(() => bad.buildEnd.call(ctxFor(racy(true)))).toThrow(/unexpectedly wrapped: \/x\.js; not wrapped: none/);
  });
});

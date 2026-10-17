/* eslint-env jest */
'use strict';

const fs = require('fs-extra');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { findControllerDeps, MOUNT_RUNTIME } = require('./generate-bootstrap');

let tmpDir;

/**
 * Write a component's client.js into the temp project.
 * @param {string} name - component name
 * @param {string} source - file contents
 * @returns {string} absolute path of the file
 */
function writeClient(name, source) {
  const file = path.join(tmpDir, 'components', name, 'client.js');

  fs.ensureDirSync(path.dirname(file));
  fs.writeFileSync(file, source);
  return file;
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claycli-controller-deps-'));
});

afterEach(() => {
  fs.removeSync(tmpDir);
});

describe('findControllerDeps', () => {
  it('finds literal DS.get and $module.get lookups, with either quote style', () => {
    const files = [
      writeClient('ad', "DS.controller('ad', function () {});"),
      writeClient('banner', "DS.controller('banner', function () {});"),
      writeClient('sticky-list', "DS.get('ad', el);\nDS.get(\"banner\", el);"),
      writeClient('ad-repeat', "$module.get('ad', el);"),
    ];

    expect(findControllerDeps(files).deps).toEqual({
      'sticky-list': ['ad', 'banner'],
      'ad-repeat': ['ad'],
    });
  });

  it('finds a lookup written as window.DS.get, but not one on an unrelated name like myDS.get', () => {
    const files = [
      writeClient('ad', "DS.controller('ad', function () {});"),
      writeClient('a', "window.DS.get('ad', el);"),
      writeClient('b', "myDS.get('ad', el);"),
    ];

    expect(findControllerDeps(files).deps).toEqual({ a: ['ad'] });
  });

  it('ignores lookups that only appear in comments', () => {
    const files = [
      writeClient('ad', "DS.controller('ad', function () {});"),
      writeClient('commented', "// DS.get('ad', el) would run here\n/* DS.get('ad') too,\n   and DS.get() in prose */\nmodule.exports = () => {};"),
    ];
    const result = findControllerDeps(files);

    expect(result.deps).toEqual({});
    expect(result.unresolved).toEqual([]);
  });

  it('ignores a lookup of itself and of a component that has no client.js', () => {
    const files = [writeClient('form', "DS.get('form', el); DS.get('ghost', el);")];

    expect(findControllerDeps(files).deps).toEqual({});
  });

  it('follows lookups made by the components that are looked up', () => {
    const files = [
      writeClient('a', "DS.get('b', el);"),
      writeClient('b', "DS.get('c', el);"),
      writeClient('c', "DS.controller('c', function () {});"),
    ];

    expect(findControllerDeps(files).deps).toEqual({ a: ['b', 'c'], b: ['c'] });
  });

  it('terminates when two components look each other up', () => {
    const files = [writeClient('a', "DS.get('b', el);"), writeClient('b', "DS.get('a', el);")];

    expect(findControllerDeps(files).deps).toEqual({ a: ['b'], b: ['a'] });
  });

  it('ignores layouts and files outside components/', () => {
    const layout = path.join(tmpDir, 'layouts', 'home', 'client.js');

    fs.ensureDirSync(path.dirname(layout));
    fs.writeFileSync(layout, "DS.get('ad', el);");

    expect(findControllerDeps([layout, writeClient('ad', 'x')]).deps).toEqual({});
  });

  it('reports lookups whose name is not a string literal, and counts them', () => {
    const files = [
      writeClient('ad', "DS.controller('ad', function () {});"),
      writeClient('dynamic', "DS.get(name, el);\n$module.get(`a${b}`, el);\nDS.get('ad', el);"),
    ];
    const result = findControllerDeps(files);

    expect(result.deps).toEqual({ dynamic: ['ad'] });
    expect(result.unresolved).toEqual([{ component: 'dynamic', count: 2 }]);
  });
});

describe('generateViteBootstrap controller dependencies', () => {
  let cwdSpy;

  afterEach(() => {
    if (cwdSpy) cwdSpy.mockRestore();
    cwdSpy = null;
    jest.dontMock('./generate-env-init');
    jest.dontMock('../../config-file-helpers');
    jest.resetModules();
  });

  /**
   * Generate the bootstrap for the temp project, with its env generator and config mocked.
   * @returns {Promise<string>} the generated bootstrap source
   */
  async function generate() {
    cwdSpy = jest.spyOn(process, 'cwd').mockReturnValue(tmpDir);
    jest.resetModules();
    jest.doMock('./generate-env-init', () => ({ generateViteEnvInit: jest.fn().mockResolvedValue('') }));
    jest.doMock('../../config-file-helpers', () => ({ getConfigValue: jest.fn().mockReturnValue(undefined) }));

    const { generateViteBootstrap, VITE_BOOTSTRAP_FILE } = require('./generate-bootstrap');

    await generateViteBootstrap();
    return fs.readFile(VITE_BOOTSTRAP_FILE, 'utf8');
  }

  /**
   * The build warnings about lookups the scanner cannot read.
   * @param {jest.SpyInstance} warn - the console.warn spy
   * @returns {string[]} matching warning messages
   */
  function lookupWarnings(warn) {
    return warn.mock.calls.map(args => String(args[0])).filter(m => m.includes('not a string literal'));
  }

  it('writes the derived dependencies into the view bootstrap, before the mount runtime', async () => {
    writeClient('ad', "DS.controller('ad', function () {});");
    writeClient('sticky-list', "DS.get('ad', el);");

    const content = await generate();

    expect(content).toContain('const _clayClientDeps = {"sticky-list":["ad"]};');
    expect(content.indexOf('const _clayClientDeps')).toBeLessThan(content.indexOf('function mountComponentModules'));
  });

  it('writes an empty map when nothing looks anything up', async () => {
    writeClient('article', 'module.exports = function () {};');

    expect(await generate()).toContain('const _clayClientDeps = {};');
  });

  it('warns once, naming the component, about lookups it cannot read', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

    writeClient('dynamic', 'DS.get(name, el);');
    await generate();

    const messages = lookupWarnings(warn);

    warn.mockRestore();
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain('components/dynamic/client.js (1)');
  });

  it('does not warn when every lookup is a literal', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

    writeClient('ad', "DS.controller('ad', function () {});");
    writeClient('sticky-list', "DS.get('ad', el);");
    await generate();

    const messages = lookupWarnings(warn);

    warn.mockRestore();
    expect(messages).toHaveLength(0);
  });
});

/**
 * A promise that is resolved or rejected from outside, to control when a module "loads".
 * @returns {{promise: Promise, resolve: Function, reject: Function}} the promise and its handles
 */
function deferred() {
  const handles = {};

  handles.promise = new Promise((resolve, reject) => {
    handles.resolve = resolve;
    handles.reject = reject;
  });
  return handles;
}

/**
 * Let already-settled promise callbacks run.
 * @returns {Promise<void>} resolves after the pending microtasks and immediates
 */
function flush() {
  return new Promise(resolve => setImmediate(resolve));
}

/**
 * Run the real mount runtime (the text that ends up in the bootstrap) against a fake page, with
 * module loads that the test settles by hand.
 *
 * @param {Object} page - what is on the page
 * @param {string[]} page.elements - component names, one element each, in document order
 * @param {Object<string, Function>} page.modules - component name -> () => Promise for its module
 * @param {Object<string, string[]>} page.deps - the derived dependency map
 * @returns {{mounts: string[]}} the legacy controllers mounted so far, in order ("ds:name")
 */
function runMountRuntime({ elements, modules, deps }) {
  const mounts = [];
  const moduleMap = {};

  Object.keys(modules).forEach(name => {
    moduleMap[`components/${name}/client.js`] = modules[name];
  });

  const sandbox = {
    console: { debug() {}, warn() {}, error() {}, groupCollapsed() {}, groupEnd() {}, table() {}, log() {} },
    performance: { mark() {}, measure() {}, getEntriesByName: () => [{ duration: 0 }] },
    NodeFilter: { SHOW_COMMENT: 128, FILTER_ACCEPT: 1, FILTER_SKIP: 3 },
    document: {
      documentElement: {},
      createNodeIterator: () => ({ nextNode: () => null }),
      querySelectorAll: () => elements.map(name => ({ dataset: { uri: `site.com/_components/${name}/instances/x@published` } })),
    },
    window: { DS: { get: name => { mounts.push(`ds:${name}`); } } },
    Promise,
    Array,
    setTimeout,
    clearTimeout,
    _clayClientModules: moduleMap,
    _clayClientDeps: deps,
  };

  vm.createContext(sandbox);
  vm.runInContext(MOUNT_RUNTIME, sandbox);
  return { mounts };
}

describe('the mount runtime and controller dependencies', () => {
  // A bare object module is a legacy controller, mounted with DS.get; a function module is called.
  const legacy = () => ({});

  // The runtime starts a 3 second timer per waiting controller. Fake timers keep them from outliving
  // the tests; setImmediate stays real so flush() still works.
  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick'] });
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it('mounts a controller only after the controller it looks up has loaded', async () => {
    const ad = deferred();
    const sticky = deferred();
    const { mounts } = runMountRuntime({
      elements: ['sticky-list', 'ad'],
      modules: { 'sticky-list': () => sticky.promise, ad: () => ad.promise },
      deps: { 'sticky-list': ['ad'] },
    });

    sticky.resolve(legacy());
    await flush();
    expect(mounts).not.toContain('ds:sticky-list');

    ad.resolve(legacy());
    await flush();
    expect(mounts).toEqual(expect.arrayContaining(['ds:ad', 'ds:sticky-list']));
    expect(mounts.indexOf('ds:ad')).toBeLessThan(mounts.indexOf('ds:sticky-list'));
  });

  it('would mount the dependent first without the dependency map (the bug this fixes)', async () => {
    const ad = deferred();
    const sticky = deferred();
    const { mounts } = runMountRuntime({
      elements: ['sticky-list', 'ad'],
      modules: { 'sticky-list': () => sticky.promise, ad: () => ad.promise },
      deps: {},
    });

    sticky.resolve(legacy());
    await flush();
    expect(mounts).toEqual(['ds:sticky-list']);
  });

  it('does not wait for a dependency that has no element on the page', async () => {
    const adLoad = jest.fn(() => new Promise(() => {}));
    const { mounts } = runMountRuntime({
      elements: ['sticky-list'],
      modules: { 'sticky-list': () => Promise.resolve(legacy()), ad: adLoad },
      deps: { 'sticky-list': ['ad'] },
    });

    await flush();
    expect(mounts).toEqual(['ds:sticky-list']);
    expect(adLoad).not.toHaveBeenCalled();
  });

  it('does not hold back function exports or controllers that look nothing up', async () => {
    const ad = deferred();
    const called = [];
    const { mounts } = runMountRuntime({
      elements: ['global-nav', 'follow', 'sticky-list', 'ad'],
      modules: {
        'global-nav': () => Promise.resolve(() => { called.push('global-nav'); }),
        follow: () => Promise.resolve(legacy()),
        'sticky-list': () => Promise.resolve(legacy()),
        ad: () => ad.promise,
      },
      deps: { 'sticky-list': ['ad'] },
    });

    await flush();
    expect(called).toEqual(['global-nav']);
    expect(mounts).toEqual(['ds:follow']);
  });

  it('mounts the dependent anyway once the dependency fails to load', async () => {
    const ad = deferred();
    const { mounts } = runMountRuntime({
      elements: ['sticky-list', 'ad'],
      modules: { 'sticky-list': () => Promise.resolve(legacy()), ad: () => ad.promise },
      deps: { 'sticky-list': ['ad'] },
    });

    await flush();
    expect(mounts).toEqual([]);

    ad.reject(new Error('chunk failed'));
    await flush();
    expect(mounts).toEqual(['ds:sticky-list']);
  });

  it('stops waiting after 3 seconds, so one stalled chunk cannot hold a controller back for good', async () => {
    const { mounts } = runMountRuntime({
      elements: ['sticky-list', 'ad'],
      modules: { 'sticky-list': () => Promise.resolve(legacy()), ad: () => new Promise(() => {}) },
      deps: { 'sticky-list': ['ad'] },
    });

    await flush();
    jest.advanceTimersByTime(2999);
    await flush();
    expect(mounts).toEqual([]);

    jest.advanceTimersByTime(1);
    await flush();
    expect(mounts).toEqual(['ds:sticky-list']);
  });

  it('loads each module once, however many elements use it', async () => {
    const load = jest.fn(() => Promise.resolve(legacy()));

    runMountRuntime({
      elements: ['ad', 'ad', 'sticky-list'],
      modules: { ad: load, 'sticky-list': () => Promise.resolve(legacy()) },
      deps: { 'sticky-list': ['ad'] },
    });

    await flush();
    expect(load).toHaveBeenCalledTimes(1);
  });
});

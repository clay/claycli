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

  it('does not read the start of a built name as the whole name', () => {
    const files = [
      writeClient('ad', "DS.controller('ad', function () {});"),
      writeClient('built', "DS.get('ad' + kind, el);\nDS.get('ad'.concat(kind), el);\n$module.get(\"ad\" +\n  kind);"),
      writeClient('spaced', "DS.get( 'ad' , el);\n$module.get('ad')"),
    ];
    const result = findControllerDeps(files);

    expect(result.deps).toEqual({ spaced: ['ad'] });
    expect(result.unresolved).toEqual([{ component: 'built', count: 3 }]);
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
   * @param {Object} [config] - claycli.config.js values
   * @returns {Promise<string>} the generated bootstrap source
   */
  async function generate(config = {}) {
    cwdSpy = jest.spyOn(process, 'cwd').mockReturnValue(tmpDir);
    jest.resetModules();
    jest.doMock('./generate-env-init', () => ({ generateViteEnvInit: jest.fn().mockResolvedValue('') }));
    jest.doMock('../../config-file-helpers', () => ({ getConfigValue: jest.fn(key => config[key]) }));

    const { generateViteBootstrap, VITE_BOOTSTRAP_FILE } = require('./generate-bootstrap');

    await generateViteBootstrap();
    return fs.readFile(VITE_BOOTSTRAP_FILE, 'utf8');
  }

  it('turns autoMount on only when claycli.config.js sets autoMount: true', async () => {
    const on = await generate({ autoMount: true });
    // required after generate(), so the path is in the temp project
    const { VITE_BOOTSTRAP_NO_MOUNT_FILE } = require('./generate-bootstrap');
    const noMount = await fs.readFile(VITE_BOOTSTRAP_NO_MOUNT_FILE, 'utf8');

    expect(on).toContain('const _clayAutoMount = true;');
    expect(on.indexOf('const _clayAutoMount')).toBeLessThan(on.indexOf('function mountComponentModules'));
    expect(noMount).not.toContain('_clayAutoMount');
    expect(await generate({ autoMount: 'yes' })).not.toContain('const _clayAutoMount');
    expect(await generate()).not.toContain('const _clayAutoMount');
  });

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
 * @param {Object[]} [page.extraElements] - fake elements also on the page, after `elements`
 * @param {boolean} [page.noDS] - start without window.DS
 * @param {boolean} [page.autoMount] - the bootstrap's _clayAutoMount; left out unless given
 * @returns {Object} mounts (the legacy controllers mounted so far, "ds:name"), page (its elements),
 *   marks (performance mark names), calls (document walks), warnings, observers (the
 *   MutationObservers it created), DS, dispatchMount, and the sandbox document and window
 */
function runMountRuntime({ elements, modules, deps, extraElements = [], noDS = false, autoMount }) {
  const mounts = [];
  const calls = { commentWalks: 0, documentQueries: 0 };
  const DS = { get: name => { mounts.push(`ds:${name}`); } };
  const marks = [];
  const warnings = [];
  const observers = [];
  const moduleMap = {};
  const page = elements.map(name => fakeEl(name)).concat(extraElements);
  const listeners = {};

  Object.keys(modules).forEach(name => {
    moduleMap[`components/${name}/client.js`] = modules[name];
  });

  /** A MutationObserver stand-in: the test calls fire(records) for a batch of mutations. */
  class FakeMutationObserver {
    /** @param {Function} callback - called with the records */
    constructor(callback) {
      this.callback = callback;
      observers.push(this);
    }
    /**
     * @param {Object} target - what is observed
     * @param {Object} options - observe options
     */
    observe(target, options) {
      this.target = target;
      this.options = options;
    }
    /** @param {Object[]} records - mutation records, each with addedNodes */
    fire(records) {
      this.callback(records);
    }
  }

  const sandbox = {
    console: {
      debug() {}, error() {}, groupCollapsed() {}, groupEnd() {}, table() {}, log() {},
      warn: (...args) => { warnings.push(args.join(' ')); },
    },
    performance: { mark(name) { marks.push(name); }, measure() {}, getEntriesByName: () => [{ duration: 0 }] },
    NodeFilter: { SHOW_COMMENT: 128, FILTER_ACCEPT: 1, FILTER_SKIP: 3 },
    document: {
      documentElement: {},
      createNodeIterator: () => {
        calls.commentWalks++;
        return { nextNode: () => null };
      },
      querySelectorAll: () => {
        calls.documentQueries++;
        return page;
      },
    },
    window: {
      DS: noDS ? undefined : DS,
      addEventListener(type, handler) {
        (listeners[type] = listeners[type] || []).push(handler);
      },
    },
    MutationObserver: FakeMutationObserver,
    Promise,
    Array,
    setTimeout,
    clearTimeout,
    _clayClientModules: moduleMap,
    _clayClientDeps: deps,
  };

  if (autoMount !== undefined) sandbox._clayAutoMount = autoMount;

  vm.createContext(sandbox);
  vm.runInContext(MOUNT_RUNTIME, sandbox);

  /**
   * Dispatch clay:mount the way a page would, from target.
   * @param {Object} target - the element, document or window the event is dispatched from
   * @param {*} [detail] - the event's detail; an object gets `mounted` set on it
   * @returns {Promise|undefined} detail.mounted, when detail is an object
   */
  function dispatchMount(target, detail = {}) {
    (listeners['clay:mount'] || []).forEach(handler => handler({ type: 'clay:mount', target, detail }));
    return detail && detail.mounted;
  }

  return {
    mounts, page, marks, calls, warnings, observers, DS, dispatchMount,
    document: sandbox.document, window: sandbox.window,
  };
}

/**
 * A fake component element, optionally with component elements under it.
 * @param {string} name - component name
 * @param {Object[]} [children] - fake elements under this one
 * @returns {Object} an object with the parts of an Element the mount runtime uses
 */
function fakeEl(name, children = []) {
  return {
    nodeType: 1,
    isConnected: true,
    dataset: { uri: `site.com/_components/${name}/instances/x@published` },
    matches: () => true,
    querySelectorAll: () => children,
  };
}

/**
 * A fake element that is not a component, e.g. the div that new HTML was put in.
 * @param {Object[]} [children] - fake component elements under it
 * @returns {Object} an object with the parts of an Element the mount runtime uses
 */
function fakeContainer(children = []) {
  return { nodeType: 1, isConnected: true, dataset: {}, matches: () => false, querySelectorAll: () => children };
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

describe('the clay:mount event', () => {
  let called;
  const fn = name => () => Promise.resolve(() => { called.push(name); });
  const modules = () => ({ nav: fn('nav'), video: fn('video'), recirc: fn('recirc') });

  beforeEach(() => {
    called = [];
  });

  it('mounts the components at or under the element it is dispatched from', async () => {
    const { dispatchMount } = runMountRuntime({ elements: ['nav'], modules: modules(), deps: {} });

    await flush();
    expect(called).toEqual(['nav']);

    await dispatchMount(fakeEl('recirc', [fakeEl('video')]));
    expect(called).toEqual(['nav', 'recirc', 'video']);
  });

  it('leaves new components outside that element alone', async () => {
    const { dispatchMount, page } = runMountRuntime({ elements: ['nav'], modules: modules(), deps: {} });

    await flush();
    page.push(fakeEl('video'));
    await dispatchMount(fakeEl('recirc'));
    expect(called).toEqual(['nav', 'recirc']);

    await dispatchMount(page[1]);
    expect(called).toEqual(['nav', 'recirc', 'video']);
  });

  it('mounts what is under a plain container, and not the container itself', async () => {
    const { dispatchMount } = runMountRuntime({ elements: [], modules: modules(), deps: {} });

    await dispatchMount(fakeContainer([fakeEl('recirc'), fakeEl('video')]));
    expect(called).toEqual(['recirc', 'video']);
  });

  it('ignores the event from window, document or anything that is not an element, and says so', async () => {
    const { dispatchMount, page, window, document, warnings } = runMountRuntime({ elements: ['nav'], modules: modules(), deps: {} });

    await flush();
    page.push(fakeEl('recirc'));
    expect(dispatchMount(window)).toBeUndefined();
    expect(dispatchMount(document)).toBeUndefined();
    expect(dispatchMount({ nodeType: 3 })).toBeUndefined();
    await flush();
    expect(called).toEqual(['nav']);
    expect(warnings.filter(w => w.includes('must be dispatched from an element'))).toHaveLength(3);
  });

  it('still mounts, and does not throw, when detail cannot be written to or is not an object', async () => {
    const { dispatchMount } = runMountRuntime({ elements: [], modules: modules(), deps: {} });

    expect(() => dispatchMount(fakeEl('recirc'), Object.freeze({}))).not.toThrow();
    expect(dispatchMount(fakeEl('video'), null)).toBeNull();
    await flush();
    expect(called).toEqual(['recirc', 'video']);
  });

  it('mounts an element once: the same element again, one inside another, one already on the page', async () => {
    const video = fakeEl('video');
    const recirc = fakeEl('recirc', [video]);
    const { dispatchMount, page } = runMountRuntime({ elements: ['nav'], modules: modules(), deps: {} });

    await flush();
    await dispatchMount(recirc);
    await dispatchMount(video);
    await dispatchMount(recirc);
    await dispatchMount(page[0]);
    expect(called).toEqual(['nav', 'recirc', 'video']);
  });

  it('mounts an element once when events overlap', async () => {
    const recirc = fakeEl('recirc');
    const { dispatchMount } = runMountRuntime({ elements: [], modules: modules(), deps: {} });

    await Promise.all([dispatchMount(recirc), dispatchMount(recirc)]);
    expect(called).toEqual(['recirc']);
  });

  it('makes a later event wait for an element an earlier one is still mounting', async () => {
    const recirc = deferred();
    const el = fakeEl('recirc');
    const { dispatchMount } = runMountRuntime({ elements: [], modules: { recirc: () => recirc.promise }, deps: {} });
    const first = dispatchMount(el);

    let secondDone = false;

    dispatchMount(el).then(() => { secondDone = true; });
    await flush();
    expect(secondDone).toBe(false);

    recirc.resolve(() => { called.push('recirc'); });
    await first;
    await flush();
    expect(called).toEqual(['recirc']);
    expect(secondDone).toBe(true);
  });

  it('mounts an element once even if its data-uri changes', async () => {
    const slot = fakeEl('recirc');
    const { dispatchMount } = runMountRuntime({ elements: [], modules: modules(), deps: {} });

    await dispatchMount(slot);
    slot.dataset.uri = 'site.com/_components/video/instances/next@published';
    await dispatchMount(slot);
    expect(called).toEqual(['recirc']);
  });

  it('lets a later event mount an element whose module failed to load', async () => {
    let attempts = 0;
    const recirc = fakeEl('recirc');
    const flaky = () => ++attempts === 1 ? Promise.reject(new Error('network')) : fn('recirc')();
    const { dispatchMount } = runMountRuntime({ elements: [], modules: { recirc: flaky }, deps: {} });

    await dispatchMount(recirc);
    expect(called).toEqual([]);

    await dispatchMount(recirc);
    expect(called).toEqual(['recirc']);
  });

  it('lets a later event mount a legacy controller that had no DS to mount with', async () => {
    const sticky = fakeEl('sticky-list');
    const { dispatchMount, mounts, window, DS } = runMountRuntime({
      elements: [],
      modules: { 'sticky-list': () => Promise.resolve({}) },
      deps: {},
      noDS: true,
    });

    await dispatchMount(sticky);
    expect(mounts).toEqual([]);

    window.DS = DS;
    await dispatchMount(sticky);
    expect(mounts).toEqual(['ds:sticky-list']);
  });

  it('does not run a mount function again after it threw', async () => {
    let runs = 0;
    const recirc = fakeEl('recirc');
    const throws = () => Promise.resolve(() => { runs++; throw new Error('half way'); });
    const { dispatchMount } = runMountRuntime({ elements: [], modules: { recirc: throws }, deps: {} });

    await dispatchMount(recirc);
    await dispatchMount(recirc);
    expect(runs).toBe(1);
  });

  it('neither waits for the page-load preloads nor walks the document when nothing looks anything up', async () => {
    const { dispatchMount, calls } = runMountRuntime({ elements: ['nav'], modules: modules(), deps: {} });

    await flush();
    const before = Object.assign({}, calls);

    await dispatchMount(fakeEl('recirc'));
    expect(calls).toEqual(before);
  });

  it('waits for a DS dependency that is on the page but outside the element', async () => {
    jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick'] });

    const ad = deferred();
    const legacy = () => ({});
    const { dispatchMount, mounts } = runMountRuntime({
      elements: [],
      extraElements: [fakeEl('ad')],
      modules: { 'sticky-list': () => Promise.resolve(legacy()), ad: () => ad.promise },
      deps: { 'sticky-list': ['ad'] },
    });
    const done = dispatchMount(fakeEl('sticky-list'));

    await flush();
    expect(mounts).not.toContain('ds:sticky-list');

    ad.resolve(legacy());
    await done;
    expect(mounts.indexOf('ds:ad')).toBeLessThan(mounts.indexOf('ds:sticky-list'));

    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it('puts only the page-load mount on the performance timeline', async () => {
    const { dispatchMount, marks } = runMountRuntime({ elements: [], modules: modules(), deps: {} });

    await flush();
    await dispatchMount(fakeEl('nav'));
    await dispatchMount(fakeEl('video'));
    expect(marks).toEqual(['clay-components-start', 'clay-components-end']);
  });
});

describe('autoMount', () => {
  let called;
  const fn = name => () => Promise.resolve(() => { called.push(name); });
  const modules = () => ({ nav: fn('nav'), video: fn('video'), recirc: fn('recirc') });

  beforeEach(() => {
    called = [];
  });

  it('does not watch the page unless the bootstrap was built with autoMount', async () => {
    const off = runMountRuntime({ elements: ['nav'], modules: modules(), deps: {} });
    const falseValue = runMountRuntime({ elements: ['nav'], modules: modules(), deps: {}, autoMount: false });

    await flush();
    expect(off.observers).toHaveLength(0);
    expect(falseValue.observers).toHaveLength(0);
  });

  it('starts watching once the page-load components are found, and mounts components added later', async () => {
    const { observers, document } = runMountRuntime({ elements: ['nav'], modules: modules(), deps: {}, autoMount: true });

    expect(observers).toHaveLength(0);
    await flush();
    expect(observers).toHaveLength(1);
    expect(observers[0].target).toBe(document.documentElement);
    expect(observers[0].options).toEqual({ childList: true, subtree: true });

    const video = fakeEl('video');

    // querySelectorAll returns every descendant, as the DOM's does
    observers[0].fire([{ addedNodes: [fakeContainer([fakeEl('recirc', [video]), video])] }]);
    await flush();
    expect(called).toEqual(['nav', 'recirc', 'video']);
  });

  it('skips text nodes and elements removed again before the callback ran', async () => {
    const { observers } = runMountRuntime({ elements: [], modules: modules(), deps: {}, autoMount: true });
    const gone = fakeEl('recirc');

    gone.isConnected = false;
    await flush();
    observers[0].fire([{ addedNodes: [{ nodeType: 3 }, gone] }]);
    await flush();
    expect(called).toEqual([]);
  });

  it('does not mount an element again when it is moved, added twice in a batch, or also sent clay:mount', async () => {
    const recirc = fakeEl('recirc');
    const { observers, page, dispatchMount } = runMountRuntime({ elements: ['nav'], modules: modules(), deps: {}, autoMount: true });

    await flush();
    observers[0].fire([{ addedNodes: [page[0]] }, { addedNodes: [recirc, recirc] }]);
    await dispatchMount(recirc);
    await flush();
    expect(called).toEqual(['nav', 'recirc']);
  });
});

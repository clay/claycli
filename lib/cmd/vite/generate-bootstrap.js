'use strict';

const fs = require('fs-extra');
const path = require('path');
const { globSync } = require('glob');
const { getConfigValue } = require('../../config-file-helpers');
const { generateViteEnvInit } = require('./generate-env-init');

const CWD = process.cwd();
const CLAY_DIR = path.join(CWD, '.clay');
const VITE_BOOTSTRAP_FILE = path.join(CLAY_DIR, 'vite-bootstrap.js');
const GLOBALS_INIT_FILE = path.join(CLAY_DIR, '_globals-init.js');

const VITE_BOOTSTRAP_KEY = '.clay/vite-bootstrap';

/**
 * Component mount runtime injected into the bootstrap.
 *
 * Scans DOM comments for Clay component markers, pre-loads all matched
 * client modules in parallel, then walks [data-uri] elements and mounts
 * each component via its default export or via DS.get().
 */
const MOUNT_RUNTIME = `\
// ── Component mounting (Vite bootstrap) ─────────────────────────────────────
var CLAY_INSTANCE_KIND = /_components\\/(.+?)(\\/instances|$)/;

function mountComponentModules() {
  performance.mark('clay-components-start');

  return new Promise(function(resolve) {
    var iterator = document.createNodeIterator(
      document.documentElement,
      NodeFilter.SHOW_COMMENT,
      function(node) {
        return node.nodeValue && node.nodeValue.indexOf('_components/') !== -1
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_SKIP;
      }
    );

    var node, preloads = [];

    while ((node = iterator.nextNode())) {
      var pm = node.nodeValue.match(CLAY_INSTANCE_KIND);

      if (pm) {
        var preloadKey = 'components/' + pm[1] + '/client.js';

        if (_clayClientModules[preloadKey]) {
          preloads.push(_clayClientModules[preloadKey]());
        }
      }
    }

    resolve(Promise.allSettled(preloads));
  }).then(function() {
    var els = Array.from(document.querySelectorAll('[data-uri*="_components/"]'));
    var mounted = 0, errors = [];

    return Promise.allSettled(els.map(function(el) {
      var m = CLAY_INSTANCE_KIND.exec(el.dataset.uri);

      if (!m) return Promise.resolve();

      var name   = m[1];
      var key    = 'components/' + name + '/client.js';
      var loader = _clayClientModules[key];

      if (!loader) return Promise.resolve();

      return loader()
        .then(function(mod) { return mod.default != null ? mod.default : mod; })
        .then(function(mod) {
          if (typeof mod === 'function') {
            try { mod(el); mounted++; } catch(e) { errors.push(name + ' (mount): ' + (e && e.message || e)); }
          } else if (window.DS && typeof window.DS.get === 'function') {
            try { window.DS.get(name, el); mounted++; } catch(e) { errors.push(name + ': ' + e.message); }
          }
        })
        .catch(function(e) { errors.push(name + ' (load): ' + (e && e.message || e)); });
    })).then(function() {
      console.debug('[clay vite] mounted ' + mounted + '/' + els.length + ' components');
      if (errors.length) console.warn('[clay vite] mount errors:', errors);
    });
  }).finally(function() {
    performance.mark('clay-components-end');
    performance.measure('clay-components', 'clay-components-start', 'clay-components-end');
    var dur = (performance.getEntriesByName('clay-components').pop() || {}).duration;

    console.debug('[clay vite] components took ' + dur + 'ms');
  });
}

mountComponentModules().catch(console.error);
`;

/**
 * Generate .clay/vite-bootstrap.js — the single ESM entry point for view mode.
 *
 * Contains:
 *   1. Static import of _globals-init.js (runs synchronously before any
 *      component dynamic import, ensuring window.DS etc. are available).
 *   2. Sticky custom-event shim (when stickyEvents is configured).
 *   3. _clayClientModules map — one lazy import() per component/layout client.js.
 *   4. mountComponentModules() runtime — scans DOM and mounts components.
 *
 * @returns {Promise<string>} absolute path to the written bootstrap file
 */
async function generateViteBootstrap() {
  await generateViteEnvInit();

  const clientFiles = [
    ...globSync(path.join(CWD, 'components', '**', 'client.js')),
    ...globSync(path.join(CWD, 'layouts', '**', 'client.js')),
  ];

  const toRel = absPath => {
    const rel = path.relative(CLAY_DIR, absPath).replace(/\\/g, '/');

    return rel.startsWith('.') ? rel : `./${rel}`;
  };

  const moduleEntries = clientFiles.map(f => {
    const key = path.relative(CWD, f).replace(/\\/g, '/');

    return `  ${JSON.stringify(key)}: () => import(${JSON.stringify(toRel(f))})`;
  }).join(',\n');

  // ── Sticky events shim ───────────────────────────────────────────────────
  const stickyEvents = getConfigValue('stickyEvents') || [];
  const stickyListeners = stickyEvents
    .map(n => `  _orig(${JSON.stringify(n)}, function(ev) { fired[${JSON.stringify(n)}] = ev.detail; });`)
    .join('\n');

  const stickyShimBlock = stickyEvents.length === 0 ? '' : `\
;(function clayViteStickyEvents() {
  var fired = {};
  var _orig = window.addEventListener.bind(window);

  window.addEventListener = function(type, handler, options) {
    _orig(type, handler, options);

    if (Object.prototype.hasOwnProperty.call(fired, type)) {
      Promise.resolve().then(function() {
        handler(new CustomEvent(type, { detail: fired[type] }));
      });
    }
  };

${stickyListeners}
}());
`;

  const globalsImport = await fs.pathExists(GLOBALS_INIT_FILE)
    ? "import './_globals-init.js';\n"
    : '// no global/js — skipping _globals-init\n';

  const envInitImport = "import './_env-init.js';\n";

  // Clay-kiln's preloader does `Object.keys(window.modules)` to find
  // component model.js / kiln.js registrations that Browserify's megabundler
  // assigns there at page load. Under Vite there is no Browserify runtime,
  // so nothing populates `window.modules` before kiln's DOMContentLoaded
  // handler fires — reading it throws `TypeError: Cannot convert undefined
  // or null to object`. Stubbing it here (synchronously, before any dynamic
  // import runs) lets kiln short-circuit that loop into a harmless
  // `Object.keys({})`, then fall through to the already-populated
  // `window.kiln.componentModels` / `componentKilnjs` maps that
  // vite-kiln-edit-init.js writes in edit mode. View-mode pages never call
  // this path but pay no cost for the empty object.
  const kilnCompatStub = 'window.modules = window.modules || {};\n';

  const content = [
    '// AUTO-GENERATED — clay vite bootstrap (do not edit)',
    `// ${new Date().toISOString()}`,
    '// This file is the single ESM entry point injected into every page via',
    '// <script type="module">. It runs the global initializers synchronously,',
    '// then scans the DOM and dynamically imports only the component modules',
    '// present on the current page — keeping initial parse cost low.',
    '',
    kilnCompatStub,
    envInitImport,
    globalsImport,
    stickyShimBlock,
    'const _clayClientModules = {',
    moduleEntries,
    '};',
    '',
    MOUNT_RUNTIME,
  ].join('\n');

  await fs.ensureDir(CLAY_DIR);
  await fs.writeFile(VITE_BOOTSTRAP_FILE, content, 'utf8');

  return VITE_BOOTSTRAP_FILE;
}

module.exports = {
  generateViteBootstrap,
  VITE_BOOTSTRAP_FILE,
  VITE_BOOTSTRAP_KEY,
};

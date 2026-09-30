'use strict';

const fs = require('fs-extra');
const path = require('path');
const { globSync } = require('glob');
const { getConfigValue } = require('../../config-file-helpers');
const { generateViteEnvInit } = require('./generate-env-init');

const CWD = process.cwd();
const CLAY_DIR = path.join(CWD, '.clay');
const VITE_BOOTSTRAP_FILE = path.join(CLAY_DIR, 'vite-bootstrap.js');
const VITE_BOOTSTRAP_NO_MOUNT_FILE = path.join(CLAY_DIR, 'vite-bootstrap-no-mount.js');
const GLOBALS_INIT_FILE = path.join(CLAY_DIR, '_globals-init.js');

const VITE_BOOTSTRAP_KEY = '.clay/vite-bootstrap';
const VITE_BOOTSTRAP_NO_MOUNT_KEY = '.clay/vite-bootstrap-no-mount';

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

// Normalize unknown thrown values into a consistent JSON-friendly payload so
// mount diagnostics are readable in browser consoles and issue reports.
function serializeError(error) {
  if (error == null) return { message: 'Unknown error' };
  if (typeof error === 'string') return { message: error };
  if (typeof error !== 'object') return { message: String(error) };

  var payload = {
    name: error.name || null,
    message: error.message || String(error),
    stack: error.stack || null,
  };

  if (error.code != null) payload.code = error.code;
  if (error.cause != null) payload.cause = serializeError(error.cause);

  return payload;
}

// Record one structured error entry for preload/load/mount failures and emit
// an expandable console group with the full context.
function reportComponentError(errors, detail) {
  var payload = {
    phase: detail.phase,
    component: detail.component,
    moduleKey: detail.moduleKey,
    uri: detail.uri,
    error: serializeError(detail.error),
  };
  var message = payload.error && payload.error.message ? payload.error.message : 'Unknown error';
  var header = '[clay vite] ' + payload.phase + ' error in ' + payload.component + ': ' + message;

  errors.push(payload);

  if (console.groupCollapsed) {
    console.groupCollapsed(header);
    console.error(payload);
    console.groupEnd();
  } else {
    console.error(header, payload);
  }
}

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
          preloads.push({
            component: pm[1],
            moduleKey: preloadKey,
            promise: _clayClientModules[preloadKey](),
          });
        }
      }
    }

    resolve(preloads);
  }).then(function(preloads) {
    var errors = [];
    var preloadPromises = preloads.map(function(entry) { return entry.promise; });

    return Promise.allSettled(preloadPromises).then(function(results) {
      results.forEach(function(result, idx) {
        if (result.status === 'rejected') {
          reportComponentError(errors, {
            phase: 'preload',
            component: preloads[idx].component,
            moduleKey: preloads[idx].moduleKey,
            uri: null,
            error: result.reason,
          });
        }
      });
      return { errors: errors };
    });
  }).then(function(state) {
    var errors = state.errors;
    var els = Array.from(document.querySelectorAll('[data-uri*="_components/"]'));
    var mounted = 0;

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
            try {
              mod(el);
              mounted++;
            } catch (e) {
              reportComponentError(errors, {
                phase: 'mount',
                component: name,
                moduleKey: key,
                uri: el.dataset.uri || null,
                error: e,
              });
            }
          } else if (window.DS && typeof window.DS.get === 'function') {
            try {
              window.DS.get(name, el);
              mounted++;
            } catch (e) {
              reportComponentError(errors, {
                phase: 'ds-mount',
                component: name,
                moduleKey: key,
                uri: el.dataset.uri || null,
                error: e,
              });
            }
          }
        })
        .catch(function(e) {
          reportComponentError(errors, {
            phase: 'load',
            component: name,
            moduleKey: key,
            uri: el.dataset.uri || null,
            error: e,
          });
        });
    })).then(function() {
      console.debug('[clay vite] mounted ' + mounted + '/' + els.length + ' components');
      if (errors.length) {
        var summary = errors.map(function(entry) {
          return {
            phase: entry.phase,
            component: entry.component,
            moduleKey: entry.moduleKey,
            uri: entry.uri,
            message: entry.error && entry.error.message,
          };
        });
        console.warn('[clay vite] mount errors (' + errors.length + ')');
        if (console.table) console.table(summary);
        console.error('[clay vite] mount error details', errors);
      }
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
 * Build the initializer prelude shared by both bootstrap variants.
 *
 * Everything in here has to run in edit mode as well as view mode: kiln's
 * preloader reads `window.modules`, and kiln plugins / model.js files read env
 * through the object _env-init.js hydrates. Component mounting is the only
 * view-mode-specific part of the bootstrap, which is why it lives in
 * MOUNT_RUNTIME rather than here.
 *
 * @returns {Promise<string[]>} content lines, in evaluation order
 */
async function buildInitPrelude() {
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

  return [kilnCompatStub, envInitImport, globalsImport, stickyShimBlock];
}

/**
 * Generate the two ESM bootstrap entry points.
 *
 * .clay/vite-bootstrap.js — view mode. Contains:
 *   1. The initializer prelude (see buildInitPrelude).
 *   2. _clayClientModules map — one lazy import() per component/layout client.js.
 *   3. mountComponentModules() runtime — scans DOM and mounts components.
 *
 * .clay/vite-bootstrap-no-mount.js — edit mode. The prelude only.
 *
 * ── Why a second entry exists ────────────────────────────────────────────────
 *
 * The legacy `clay compile` pipeline resolved component client.js (and
 * _client-init.js, which mounts it) for VIEW mode only — see the `edit` branch
 * of getDependencies() in lib/cmd/compile/get-script-dependencies.js, which
 * ships model.js, kiln.js and kiln plugins but no client bundle. Editors
 * therefore never ran component controllers while in Kiln.
 *
 * Serving the view bootstrap in edit mode broke that contract: it calls
 * mountComponentModules() at module scope, so every component's client.js
 * executes as soon as the module evaluates. That runs analytics, ad calls
 * (GPT injects an <iframe> per slot), comment embeds and other third-party
 * scripts inside the editing surface, where they mutate the DOM that Kiln is
 * trying to decorate and edit.
 *
 * Edit mode still needs the prelude, so the fix is a second entry rather than
 * simply dropping the bootstrap: same initializers, no mounting.
 *
 * @returns {Promise<string>} absolute path to the written view bootstrap file
 */
async function generateViteBootstrap() {
  await generateViteEnvInit();

  const prelude = await buildInitPrelude();

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

  const timestamp = new Date().toISOString();

  const content = [
    '// AUTO-GENERATED — clay vite bootstrap (do not edit)',
    `// ${timestamp}`,
    '// This file is the ESM entry point injected into view-mode pages via',
    '// <script type="module">. It runs the global initializers synchronously,',
    '// then scans the DOM and dynamically imports only the component modules',
    '// present on the current page — keeping initial parse cost low.',
    '',
    ...prelude,
    'const _clayClientModules = {',
    moduleEntries,
    '};',
    '',
    MOUNT_RUNTIME,
  ].join('\n');

  const noMountContent = [
    '// AUTO-GENERATED — clay vite bootstrap, no-mount variant (do not edit)',
    `// ${timestamp}`,
    '// This file is the ESM entry point injected into EDIT-mode pages. It runs',
    '// the same global initializers as vite-bootstrap.js but omits the',
    '// component-mounting runtime, so component client.js files do not execute',
    '// while an editor is in Kiln — matching the legacy clay compile pipeline.',
    '',
    ...prelude,
  ].join('\n');

  await fs.ensureDir(CLAY_DIR);
  await Promise.all([
    fs.writeFile(VITE_BOOTSTRAP_FILE, content, 'utf8'),
    fs.writeFile(VITE_BOOTSTRAP_NO_MOUNT_FILE, noMountContent, 'utf8'),
  ]);

  return VITE_BOOTSTRAP_FILE;
}

module.exports = {
  generateViteBootstrap,
  VITE_BOOTSTRAP_FILE,
  VITE_BOOTSTRAP_NO_MOUNT_FILE,
  VITE_BOOTSTRAP_KEY,
  VITE_BOOTSTRAP_NO_MOUNT_KEY,
};

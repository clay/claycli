'use strict';

/**
 * Rollup-native view bootstrap: one entry that synchronously runs global scripts
 * (window.DS, etc.) before any component dynamic import. No multi-script race,
 * no _view-init, no separate globals pass.
 */

const fs = require('fs-extra');
const path = require('path');
const { globSync } = require('glob');
const { getConfigValue } = require('../../config-file-helpers');

const CWD = process.cwd();
const CLAY_DIR = path.join(CWD, '.clay');
const ROLLUP_BOOTSTRAP_FILE = path.join(CLAY_DIR, 'rollup-bootstrap.js');
const GLOBALS_INIT_ENTRY_FILE = path.join(CLAY_DIR, '_globals-init.js');

const ROLLUP_BOOTSTRAP_KEY = '.clay/rollup-bootstrap';

const MOUNT_RUNTIME = `\
// ── Component mounting (Rollup bootstrap) ───────────────────────────────────
var CLAY_INSTANCE_KIND = /_components\\/(.+?)(\\/instances|$)/;

function mountComponentModules() {
  performance.mark('clay-components-start');

  return new Promise(function (resolve) {
    var iterator = document.createNodeIterator(
      document.documentElement,
      NodeFilter.SHOW_COMMENT,
      function (node) {
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
  }).then(function () {
    var els = Array.from(document.querySelectorAll('[data-uri*="_components/"]'));
    var mounted = 0, errors = [];

    return Promise.allSettled(els.map(function (el) {
      var m = CLAY_INSTANCE_KIND.exec(el.dataset.uri);

      if (!m) return Promise.resolve();

      var name   = m[1];
      var key    = 'components/' + name + '/client.js';
      var loader = _clayClientModules[key];

      if (!loader) return Promise.resolve();

      return loader()
        .then(function (mod) { return mod.default != null ? mod.default : mod; })
        .then(function (mod) {
          if (typeof mod === 'function') {
            try {
              mod(el);
              mounted++;
            } catch (e) {
              // Separate catch so we can log useful details
              console.error('[clay rollup] ' + name + ' threw during mount:', e.message);
              console.error('[clay rollup] mod.toString():', mod.toString().slice(0, 200));
              errors.push(name + ' (mount): ' + (e && e.message || e));
            }
          } else if (window.DS && typeof window.DS.get === 'function') {
            try {
              window.DS.get(name, el);
              mounted++;
            } catch (e) {
              errors.push(name + ': ' + e.message);
            }
          }
        })
        .catch(function (e) {
          errors.push(name + ' (load): ' + (e && e.message || e));
        });
    })).then(function () {
      console.debug('[clay rollup] mounted ' + mounted + '/' + els.length + ' components');
      if (errors.length) console.warn('[clay rollup] mount errors:', errors);
    });
  }).finally(function () {
    performance.mark('clay-components-end');
    performance.measure('clay-components', 'clay-components-start', 'clay-components-end');
    var dur = (performance.getEntriesByName('clay-components').pop() || {}).duration;

    console.debug('[clay rollup] components took ' + dur + 'ms');
  });
}

mountComponentModules().catch(console.error);
`;

/**
 * @returns {Promise<string>} path to rollup-bootstrap.js
 */
async function generateRollupBootstrap() {
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

  const stickyEvents = getConfigValue('stickyEvents') || [];
  const stickyListeners = stickyEvents
    .map(n => `  _orig(${JSON.stringify(n)}, function(ev) { fired[${JSON.stringify(n)}] = ev.detail; });`)
    .join('\n');

  const stickyShimBlock = stickyEvents.length === 0 ? '' : `\
;(function clayRollupStickyEvents() {
  var fired = {};
  var _orig = window.addEventListener.bind(window);

  window.addEventListener = function (type, handler, options) {
    _orig(type, handler, options);

    if (Object.prototype.hasOwnProperty.call(fired, type)) {
      Promise.resolve().then(function () {
        handler(new CustomEvent(type, { detail: fired[type] }));
      });
    }
  };

${stickyListeners}
}());
`;

  const globalsImport = (await fs.pathExists(GLOBALS_INIT_ENTRY_FILE))
    ? "import './_globals-init.js';\n"
    : '// no global/js — skipping _globals-init\n';

  const content = [
    '// AUTO-GENERATED — clay rollup bootstrap (do not edit)',
    `// ${new Date().toISOString()}`,
    '// Globals run first (sync ESM deps), then sticky shim, then component map + mount.',
    '',
    globalsImport,
    stickyShimBlock,
    'var _clayClientModules = {',
    moduleEntries,
    '};',
    '',
    MOUNT_RUNTIME,
  ].join('\n');

  await fs.ensureDir(CLAY_DIR);
  await fs.writeFile(ROLLUP_BOOTSTRAP_FILE, content, 'utf8');

  return ROLLUP_BOOTSTRAP_FILE;
}

module.exports = {
  generateRollupBootstrap,
  ROLLUP_BOOTSTRAP_FILE,
  ROLLUP_BOOTSTRAP_KEY,
};

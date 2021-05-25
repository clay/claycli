/* eslint-env browser */

'use strict';

/**
 * mount legacy services from _global.js, if any
 */
function mountLegacyServices() {
  Object.keys(window.modules)
    .filter((key) => typeof key === 'string' && key.match(/\.legacy$/))
    .forEach((key) => window.require(key));
}

function tryToMount(fn, el, name) {
  try {
    fn(el); // init the controller
  } catch (e) {
    const elementTag = el.outerHTML.slice(0, el.outerHTML.indexOf(el.innerHTML));

    console.error(`Error initializing controller for "${name}" on "${elementTag}"`, e);
  }
}

/**
 * mount client.js component controllers
 */
function mountComponentModules() {
  Object.keys(window.modules)
    .filter((key) => typeof key === 'string' && key.match(/\.client$/))
    .forEach((key) => {
      let controllerFn = window.require(key);

      if (typeof controllerFn === 'function') {
        const name = key.replace('.client', ''),
          instancesSelector = `[data-uri*="_components/${name}/"]`,
          defaultSelector = `[data-uri$="_components${name}"]`,
          instances = document.querySelectorAll(instancesSelector),
          defaults = document.querySelectorAll(defaultSelector);

        for (let el of instances) {
          tryToMount(controllerFn, el, name);
        }

        for (let el of defaults) {
          tryToMount(controllerFn, el, name);
        }
      }
    });
}

// Make sure that a `window.process.env.NODE_ENV` is available in the client for any dependencies,
// services, or components that could require it
// note: the `#NODE_ENV#` value is swapped for the actual environment variable in /lib/cmd/compile/scripts.js
window.process = window.process || {};
window.process.env = window.process.env || {};
if (!window.process.env.NODE_ENV) {
  window.process.env.NODE_ENV = '#NODE_ENV#';
}

// note: legacy controllers that require legacy services (e.g. dollar-slice) must
// wait for DOMContentLoaded to initialize themselves, as the files themselves must be mounted first
mountLegacyServices();
mountComponentModules();

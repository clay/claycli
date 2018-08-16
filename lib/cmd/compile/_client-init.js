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

// note: legacy controllers that require legacy services (e.g. dollar-slice) must
// wait for DOMContentLoaded to initialize themselves, as the files themselves must be mounted first
mountLegacyServices();
mountComponentModules();

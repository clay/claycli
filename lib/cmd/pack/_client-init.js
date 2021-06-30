/* global __WORKING_DIR__:false */
/* eslint-env browser */

'use strict';

/**
 * Find all Clay components---DOM elements whose `data-uri` attribute
 * contains "_components/"---
 *
 * @returns {Promise} - A Promise that resolves when Webpack has finished
 *    initializing Clay components.
 */
function mountComponentModules() {
  return Promise.resolve().then(() => {
    const componentSelector = '[data-uri*="_components/"]';
    const componentElements = Array.from(document.querySelectorAll(componentSelector));

    return componentElements;
  }).then(componentElements => {
    const componentPromises = componentElements.map(element => {
      const componentURI = element.dataset.uri;
      const [, name] = Array.from(/_components\/(.+?)(\/instances|$)/.exec(componentURI) || []);

      if (!name) {
        console.error('Could not match this element URI to a component name. Is the URI malformed?', {
          element,
          componentURI
        });

        return Promise.resolve();
      };

      return import(`${ __WORKING_DIR__ }/components/${name}/client.js`)
        .then(mod => mod && mod.default || mod)
        .then(mod => {
          if (typeof mod === 'function') {
            mod(element);
          }
        });
    });

    return Promise.allSettled(componentPromises);
  });
}

exports.mountComponentModules = mountComponentModules;

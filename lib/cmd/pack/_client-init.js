'use strict';

/**
 * For client-side scripts that expose a function, require each script and pass
 * the function its element.
 *
 * @returns {Promise} A Promise that resolves when all async modules are loaded.
 */
function mountComponentModules() {
  const promises = Object.keys(__webpack_modules__)
    .filter(moduleName => /components/.test(moduleName))
    .reduce((p, moduleName) => {
      const nameExp = /components\/([-A-za-z]+?)\//i.exec(moduleName);

      if (!nameExp) return p;

      const name = nameExp[1];
      const instancesSelector = `[data-uri*="_components/${name}/"]`;
      const instances = Array.from(document.querySelectorAll(instancesSelector));
      const defaultInstanceSelector = `[data-uri$="_components/${name}"]`;
      const defaultInstances = Array.from(document.querySelectorAll(defaultInstanceSelector));

      if (!instances.length && !defaultInstances.length) return p;

      const importedModule = __webpack_require__(moduleName);
      const mod = __webpack_require__.n(importedModule)();

      if (!mod) return p;

      const nextPromises = [...instances, ...defaultInstances]
        .map(el => {
          return new Promise((resolve, reject) => {
            try {
              mod(el);
              resolve();
            } catch (err) {
              reject(err);
            }
          });
        });

      return p.concat(Promise.allSettled(nextPromises));
    }, []);

  return Promise.allSettled(promises)
    .catch(err => {
      console.error('Client init error: ', err);
    });
}

if (document.readyState !== 'loading') {
  mountComponentModules();
} else {
  document.addEventListener('DOMContentLoaded', () => {
    mountComponentModules();
  });
}

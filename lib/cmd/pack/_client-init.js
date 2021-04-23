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
      const nameExp = /components\/(\w+)\./ig.exec(moduleName);

      if (!nameExp) return p;

      const name = nameExp[1];
      const instancesSelector = `[data-uri*="_components/${name}/"]`;
      const defaultSelector = `[data-uri$="_components${name}"]`;
      const instances = Array.from(document.querySelectorAll(instancesSelector));
      const defaults = Array.from(document.querySelectorAll(defaultSelector));

      if (!instances.length || !defaults.length) return p;

      const nextPromises = [].concat(instances, defaults)
        .map(el => {
          const mod = __webpack_require__(moduleName);
          const modFunction = __webpack_require__.n(mod);

          return Promise.resolve()
            .then(() => modFunction(el))
            .catch(err => {
              const elementTag = el.outerHTML.slice(0, el.outerHTML.indexOf(el.innerHTML));

              console.error(`Error initializing controller for "${name}" on "${elementTag}"`, err);
            });
        });

      return p.concat(nextPromises);
    }, []);

  return Promise.all(promises);
}

console.log(err);

mountComponentModules();

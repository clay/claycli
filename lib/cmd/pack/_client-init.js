/* eslint-env browser */
/* global __webpack_modules__:false, __webpack_require__:false */

'use strict';

/**
 * For client-side scripts that expose a function, require each script and pass
 * the function its element.
 */
function mountComponentModules() {
  Object.keys(__webpack_modules__)
    .filter(moduleName => /components/.test(moduleName))
    .forEach(moduleName => {
      const nameExp = /components\/([-A-za-z0-9]+?)\//i.exec(moduleName);

      if (!nameExp) return;

      const name = nameExp[1];
      const instancesSelector = `[data-uri*="_components/${name}/"]`;
      const instances = Array.from(document.querySelectorAll(instancesSelector));
      const defaultInstanceSelector = `[data-uri$="_components/${name}"]`;
      const defaultInstances = Array.from(document.querySelectorAll(defaultInstanceSelector));

      if (!instances.length && !defaultInstances.length) return;

      const importedModule = __webpack_require__(moduleName);
      const mod = __webpack_require__.n(importedModule)();

      if (!mod || typeof mod !== 'function') return;

      [...instances, ...defaultInstances]
        .forEach(el => {
          try {
            mod(el);
          } catch (err) {
            console.error(err);
          }
        });
    });
}

if (document.readyState !== 'loading') {
  mountComponentModules();
} else {
  document.addEventListener('DOMContentLoaded', () => {
    mountComponentModules();
  });
}

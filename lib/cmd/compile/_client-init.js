'use strict';

/**
 * mount client.js component controllers
 */
function mount() {
  const controllers = Object.keys(window.modules || {}).filter((id) => typeof id === 'string' && id.match(/\.client$/));

  controllers.forEach((controller) => {
    const componentModule = require(window.modules[controller][0]);

    console.log(controller);

    if (typeof componentModule === 'function') {
      // actual exported component controller, not a legacy / non-standard controller
      const componentName = controller.replace('.client', ''),
        selector = `[data-uri*="_components/${componentName}"]`,
        els = document.querySelectorAll(selector);

      for (let el of els) {
        try {
          console.log(componentName, el);
          componentModule(el); // init the controller
        } catch (e) {
          const elementTag = el.outerHTML.slice(0, el.outerHTML.indexOf(el.innerHTML));

          console.error(`Error initializing controller for "${componentName}" on "${elementTag}"`);
        }
      }
    }
  });
}

mount();

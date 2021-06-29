'use strict';

/**
 * For client-side scripts that expose a function, require each script and pass
 * the function its element.
 */
async function mountComponentModules() {
  const componentSelector = '[data-uri*="_components/"]';
  const componentElements = Array.from(document.querySelectorAll(componentSelector));

  await import('./global/js/client');

  for await (const element of componentElements) {
    const uri = element.dataset.uri;
    const [_, name] = Array.from(/_components\/(.+?)(\/instances|$)/.exec(uri) || []);

    if (!name) {
      console.error('Could not match element to component:', {
        element,
        uri
      });
    };

    try {
      const mod = await import(`./components/${name}/client`).then(m => m.default || m);
      mod(element);
    } catch (err) {
      console.error('Could not import component module:', {
        element,
        err,
        name
      });
    }
  }
}

(async () => {
  await mountComponentModules();
})()

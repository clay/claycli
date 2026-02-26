/**
 * Find all Clay components---DOM elements whose `data-uri` attribute
 * contains "_components/"---
 */
function mountComponentModules(callback: (name: string) => Promise<unknown>): Promise<PromiseSettledResult<unknown>[]> {
  return Promise.resolve().then(() => {
    const componentSelector = '[data-uri*="_components/"]';
    const componentElements = Array.from(document.querySelectorAll(componentSelector));

    return componentElements;
  }).then(componentElements => {
    const componentPromises = componentElements.map(element => {
      const componentURI = (element as HTMLElement).dataset.uri!;
      const [, name] = Array.from(/_components\/(.+?)(\/instances|$)/.exec(componentURI) || []);

      if (!name) {
        const err = new Error(`No component script found for ${ element } (at ${ componentURI }).`);

        console.error(err);

        return Promise.reject(err);
      }

      return Promise.resolve().then(() => {
        return callback(name);
      }).then((mod: unknown) => (mod as Record<string, unknown>)?.default || mod)
        .then((mod: unknown) => {
          if (typeof mod === 'function') {
            return mod(element);
          }
        }).then(() => {
          return `Mounted ${ componentURI } (${ name }).`;
        });
    });

    return Promise.allSettled(componentPromises);
  });
}

export = mountComponentModules;

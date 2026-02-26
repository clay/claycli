import _ from 'lodash';

const utils = require('clayutils');
const formatting = require('../formatting');
const prefixes = require('../prefixes');
const config = require('./config');
const rest = require('../rest');

type Dispatch = Record<string, unknown>;

interface ExportOptions {
  key?: string;
  layout?: boolean;
  yaml?: boolean;
  size?: number;
}

let layouts: string[] = []; // keep track of exported layouts, to dedupe the dispatches

/**
 * throw if result is an error
 */
function toError(item: unknown): unknown {
  if (item instanceof Error || _.isObject(item) && (item as Record<string, unknown>).type === 'error') {
    throw item;
  } else {
    return item;
  }
}

/**
 * export single bit of arbitrary data
 * e.g. components, lists, users
 */
async function exportSingleItem(url: string): Promise<Dispatch> {
  var res = await rest.get(url);

  toError(res);
  return { [prefixes.urlToUri(url)]: res };
}

/**
 * export single _uri
 */
async function exportSingleURI(url: string): Promise<Dispatch> {
  var res = await rest.get(url, { type: 'text' });

  toError(res);
  return { [prefixes.urlToUri(url)]: res };
}

/**
 * export all instances of a component or layout
 */
async function exportInstances(url: string, prefix: string): Promise<Dispatch[]> {
  var res = await rest.get(url), i: number, results: Dispatch[] = [];

  toError(res);
  for (i = 0; i < res.length; i++) {
    results.push(await exportSingleItem(`${prefixes.uriToUrl(prefix, res[i])}.json`));
  }
  return results;
}

/**
 * export all instances of all components
 */
async function exportAllComponents(url: string, prefix: string): Promise<Dispatch[]> {
  var res = await rest.get(url), i: number, results: Dispatch[] = [], instances: Dispatch[];

  toError(res);
  for (i = 0; i < res.length; i++) {
    instances = await exportInstances(`${prefix}/_components/${res[i]}/instances`, prefix);
    results = results.concat(instances);
  }
  return results;
}

/**
 * export all instances of all layouts
 */
async function exportAllLayouts(url: string, prefix: string): Promise<Dispatch[]> {
  var res = await rest.get(url), i: number, results: Dispatch[] = [], instances: Dispatch[];

  toError(res);
  for (i = 0; i < res.length; i++) {
    instances = await exportInstances(`${prefix}/_layouts/${res[i]}/instances`, prefix);
    results = results.concat(instances);
  }
  return results;
}

/**
 * export single page
 */
async function exportSinglePage(url: string, prefix: string, includeLayout: boolean): Promise<Dispatch[]> {
  var res = await rest.get(url), i: number, results: Dispatch[] = [], children: string[];

  toError(res);
  children = _.reduce(res as Record<string, unknown>, (uris: string[], area: unknown) => _.isArray(area) ? uris.concat(area) : uris, []);

  if (includeLayout && !_.includes(layouts, res.layout)) {
    children.push(res.layout);
    layouts.push(res.layout);
  }

  for (i = 0; i < children.length; i++) {
    results.push(await exportSingleItem(`${prefixes.uriToUrl(prefix, children[i])}.json`));
  }
  results.push({ [prefixes.urlToUri(url)]: res });
  return results;
}

/**
 * export all bits of arbitrary data
 * e.g. lists or users
 */
async function exportMultipleItems(url: string, prefix: string): Promise<Dispatch[]> {
  var res = await rest.get(url), i: number, results: Dispatch[] = [];

  toError(res);
  for (i = 0; i < res.length; i++) {
    results.push(await exportSingleItem(prefixes.uriToUrl(prefix, res[i])));
  }
  return results;
}

/**
 * export all pages
 */
async function exportAllPages(url: string, prefix: string, includeLayout: boolean): Promise<Dispatch[]> {
  var res = await rest.get(url), i: number, results: Dispatch[] = [], pageResults: Dispatch[];

  toError(res);
  for (i = 0; i < res.length; i++) {
    pageResults = await exportSinglePage(prefixes.uriToUrl(prefix, res[i]), prefix, includeLayout);
    results = results.concat(pageResults);
  }
  return results;
}

/**
 * export all _uris
 */
async function exportMultipleURIs(url: string, prefix: string): Promise<Dispatch[]> {
  var res = await rest.get(url), i: number, results: Dispatch[] = [];

  toError(res);
  for (i = 0; i < res.length; i++) {
    results.push(await exportSingleURI(prefixes.uriToUrl(prefix, res[i])));
  }
  return results;
}

/**
 * export public url
 */
async function exportPublicURL(url: string, includeLayout: boolean): Promise<Dispatch[]> {
  var result = await rest.findURI(url), i: number, pageURL: string, pageDispatches: Dispatch[], unprefixed: Dispatch[] = [];

  toError(result);
  pageURL = prefixes.uriToUrl(result.prefix, result.uri);
  pageDispatches = await exportSinglePage(pageURL, result.prefix, includeLayout);

  for (i = 0; i < pageDispatches.length; i++) {
    unprefixed.push(await prefixes.remove(pageDispatches[i], result.prefix));
  }
  return unprefixed;
}

/**
 * generate dispatches from a single url
 */
function generateExportDispatches(url: string, prefix: string, includeLayout: boolean): Promise<Dispatch[]> { // eslint-disable-line
  if (utils.isLayout(url) && utils.getLayoutName(url) && (utils.getLayoutInstance(url) || utils.isDefaultLayout(url)) || utils.isComponent(url) && utils.getComponentName(url) && (utils.getComponentInstance(url) || utils.isDefaultComponent(url))) {
    return exportSingleItem(`${url}.json`).then((d: Dispatch) => [d]);
  } else if (utils.getLayoutName(url) && !utils.getLayoutInstance(url) || utils.getComponentName(url) && !utils.getComponentInstance(url)) {
    return exportInstances(url, prefix);
  } else if (_.includes(url, '_components')) {
    return exportAllComponents(url, prefix);
  } else if (_.includes(url, '_layouts')) {
    return exportAllLayouts(url, prefix);
  } else if (utils.isPage(url) && utils.getPageInstance(url)) {
    return exportSinglePage(url, prefix, includeLayout);
  } else if (_.includes(url, '_pages')) {
    return exportAllPages(url, prefix, includeLayout);
  } else if (url.match(/\/_?(uris)\/(.+)/)) {
    return exportSingleURI(url).then((d: Dispatch) => [d]);
  } else if (url.match(/\/_?(uris)$/)) {
    return exportMultipleURIs(url, prefix);
  } else if (url.match(/\/_?(lists|users)\/(.+)/)) {
    return exportSingleItem(url).then((d: Dispatch) => [d]);
  } else if (url.match(/\/_?(lists|users)/)) {
    return exportMultipleItems(url, prefix);
  } else {
    return exportPublicURL(url, includeLayout);
  }
}

/**
 * export specific items from a single url
 */
async function fromURL(rawUrl: string, options?: ExportOptions): Promise<Dispatch[]> {
  var url: string, prefix: string | null, dispatches: Dispatch[], i: number, unprefixed: Dispatch[];

  options = options || {};
  url = config.get('url', rawUrl);

  if (!url) {
    const e: Error & { url?: string } = new Error('URL is not defined! Please specify a url to export from');

    e.url = 'undefined url';
    throw e;
  }

  try {
    prefix = prefixes.getFromUrl(url);
  } catch (_e) {
    prefix = null;
  }

  dispatches = await generateExportDispatches(url, prefix!, options.layout || false);
  unprefixed = [];
  for (i = 0; i < dispatches.length; i++) {
    unprefixed.push(await prefixes.remove(dispatches[i], prefix));
  }

  if (options.yaml) {
    return [formatting.toBootstrap(unprefixed)];
  }
  return unprefixed;
}

/**
 * export items based on elastic query
 */
function fromQuery(rawUrl: string, query?: Record<string, unknown>, options?: ExportOptions): Promise<Dispatch[]> {
  var key: string, prefix: string, fullQuery: Record<string, unknown>;

  query = query || {};
  options = options || {};
  key = config.get('key', options.key);
  prefix = config.get('url', rawUrl);

  if (!prefix) {
    const e: Error & { url?: string } = new Error('URL is not defined! Please specify a site prefix to export from');

    e.url = 'undefined prefix';
    return Promise.reject(e);
  }

  fullQuery = _.assign({
    index: 'pages',
    size: 10,
    body: {
      query: {
        prefix: {
          uri: prefixes.urlToUri(prefix)
        }
      }
    }
  }, { size: options.size }, query);

  // rest.query throws synchronously if no key
  return rest.query(`${prefix}/_search`, fullQuery, { key })
    .then(async (res: Record<string, unknown>) => {
      var i: number, dispatches: Dispatch[] = [], unprefixed: Dispatch[] = [], itemDispatches: Dispatch[];

      toError(res);
      for (i = 0; i < (res.data as unknown[]).length; i++) {
        itemDispatches = await generateExportDispatches(prefixes.uriToUrl(prefix, (res.data as Record<string, unknown>[])[i]._id), prefix, options!.layout || false);
        dispatches = dispatches.concat(itemDispatches);
      }
      for (i = 0; i < dispatches.length; i++) {
        unprefixed.push(await prefixes.remove(dispatches[i], prefix));
      }
      if (options!.yaml) {
        return [formatting.toBootstrap(unprefixed)];
      }
      return unprefixed;
    });
}

/**
 * clear the layouts cache
 */
function clearLayouts(): void {
  layouts = [];
}

export { fromURL, fromQuery, clearLayouts };

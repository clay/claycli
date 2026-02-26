import _ from 'lodash';

const utils = require('clayutils');
const formatting = require('../formatting');
const prefixes = require('../prefixes');
const config = require('./config');
const rest = require('../rest');
const { mapConcurrent } = require('../concurrency');

type Dispatch = Record<string, unknown>;

interface ExportOptions {
  key?: string;
  concurrency?: number;
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
async function exportInstances(url: string, prefix: string, concurrency: number): Promise<Dispatch[]> {
  var res = await rest.get(url);

  toError(res);
  return mapConcurrent(res, concurrency, (item: string) => {
    return exportSingleItem(`${prefixes.uriToUrl(prefix, item)}.json`);
  });
}

/**
 * export all instances of all components
 */
async function exportAllComponents(url: string, prefix: string, concurrency: number): Promise<Dispatch[]> {
  var res = await rest.get(url), allResults: Dispatch[][];

  toError(res);
  allResults = await mapConcurrent(res, concurrency, (item: string) => {
    return exportInstances(`${prefix}/_components/${item}/instances`, prefix, concurrency);
  });
  return _.flatten(allResults);
}

/**
 * export all instances of all layouts
 */
async function exportAllLayouts(url: string, prefix: string, concurrency: number): Promise<Dispatch[]> {
  var res = await rest.get(url), allResults: Dispatch[][];

  toError(res);
  allResults = await mapConcurrent(res, concurrency, (item: string) => {
    return exportInstances(`${prefix}/_layouts/${item}/instances`, prefix, concurrency);
  });
  return _.flatten(allResults);
}

/**
 * export single page
 */
async function exportSinglePage(url: string, prefix: string, includeLayout: boolean, concurrency: number): Promise<Dispatch[]> {
  var res = await rest.get(url), children: string[], results: Dispatch[];

  toError(res);
  children = _.reduce(res as Record<string, unknown>, (uris: string[], area: unknown) => _.isArray(area) ? uris.concat(area) : uris, []);

  if (includeLayout && !_.includes(layouts, res.layout)) {
    children.push(res.layout);
    layouts.push(res.layout);
  }

  results = await mapConcurrent(children, concurrency, (child: string) => {
    return exportSingleItem(`${prefixes.uriToUrl(prefix, child)}.json`);
  });
  results.push({ [prefixes.urlToUri(url)]: res });
  return results;
}

/**
 * export all bits of arbitrary data
 * e.g. lists or users
 */
async function exportMultipleItems(url: string, prefix: string, concurrency: number): Promise<Dispatch[]> {
  var res = await rest.get(url);

  toError(res);
  return mapConcurrent(res, concurrency, (item: string) => {
    return exportSingleItem(prefixes.uriToUrl(prefix, item));
  });
}

/**
 * export all pages
 */
async function exportAllPages(url: string, prefix: string, includeLayout: boolean, concurrency: number): Promise<Dispatch[]> {
  var res = await rest.get(url), allResults: Dispatch[][];

  toError(res);
  allResults = await mapConcurrent(res, concurrency, (item: string) => {
    return exportSinglePage(prefixes.uriToUrl(prefix, item), prefix, includeLayout, concurrency);
  });
  return _.flatten(allResults);
}

/**
 * export all _uris
 */
async function exportMultipleURIs(url: string, prefix: string, concurrency: number): Promise<Dispatch[]> {
  var res = await rest.get(url);

  toError(res);
  return mapConcurrent(res, concurrency, (item: string) => {
    return exportSingleURI(prefixes.uriToUrl(prefix, item));
  });
}

/**
 * export public url
 */
async function exportPublicURL(url: string, includeLayout: boolean, concurrency: number): Promise<Dispatch[]> {
  var result = await rest.findURI(url), pageURL: string, pageDispatches: Dispatch[];

  toError(result);
  pageURL = prefixes.uriToUrl(result.prefix, result.uri);
  pageDispatches = await exportSinglePage(pageURL, result.prefix, includeLayout, concurrency);

  return mapConcurrent(pageDispatches, concurrency, (dispatch: Dispatch) => {
    return prefixes.remove(dispatch, result.prefix);
  });
}

/**
 * generate dispatches from a single url
 */
function generateExportDispatches(url: string, prefix: string, includeLayout: boolean, concurrency: number): Promise<Dispatch[]> { // eslint-disable-line
  if (utils.isLayout(url) && utils.getLayoutName(url) && (utils.getLayoutInstance(url) || utils.isDefaultLayout(url)) || utils.isComponent(url) && utils.getComponentName(url) && (utils.getComponentInstance(url) || utils.isDefaultComponent(url))) {
    return exportSingleItem(`${url}.json`).then((d: Dispatch) => [d]);
  } else if (utils.getLayoutName(url) && !utils.getLayoutInstance(url) || utils.getComponentName(url) && !utils.getComponentInstance(url)) {
    return exportInstances(url, prefix, concurrency);
  } else if (_.includes(url, '_components')) {
    return exportAllComponents(url, prefix, concurrency);
  } else if (_.includes(url, '_layouts')) {
    return exportAllLayouts(url, prefix, concurrency);
  } else if (utils.isPage(url) && utils.getPageInstance(url)) {
    return exportSinglePage(url, prefix, includeLayout, concurrency);
  } else if (_.includes(url, '_pages')) {
    return exportAllPages(url, prefix, includeLayout, concurrency);
  } else if (url.match(/\/_?(uris)\/(.+)/)) {
    return exportSingleURI(url).then((d: Dispatch) => [d]);
  } else if (url.match(/\/_?(uris)$/)) {
    return exportMultipleURIs(url, prefix, concurrency);
  } else if (url.match(/\/_?(lists|users)\/(.+)/)) {
    return exportSingleItem(url).then((d: Dispatch) => [d]);
  } else if (url.match(/\/_?(lists|users)/)) {
    return exportMultipleItems(url, prefix, concurrency);
  } else {
    return exportPublicURL(url, includeLayout, concurrency);
  }
}

/**
 * export specific items from a single url
 */
async function fromURL(rawUrl: string, options?: ExportOptions): Promise<Dispatch[]> {
  var url: string, prefix: string | null, dispatches: Dispatch[], concurrency: number, unprefixed: Dispatch[];

  options = options || {};
  concurrency = options.concurrency || 10;
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

  dispatches = await generateExportDispatches(url, prefix!, options.layout || false, concurrency);
  unprefixed = await mapConcurrent(dispatches, concurrency, (dispatch: Dispatch) => {
    return prefixes.remove(dispatch, prefix);
  });

  if (options.yaml) {
    return [formatting.toBootstrap(unprefixed)];
  }
  return unprefixed;
}

/**
 * export items based on elastic query
 */
function fromQuery(rawUrl: string, query?: Record<string, unknown>, options?: ExportOptions): Promise<Dispatch[]> {
  var key: string, prefix: string, fullQuery: Record<string, unknown>, concurrency: number;

  query = query || {};
  options = options || {};
  key = config.get('key', options.key);
  concurrency = options.concurrency || 10;
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
      var allDispatches: Dispatch[][], dispatches: Dispatch[], unprefixed: Dispatch[];

      toError(res);
      allDispatches = await mapConcurrent(res.data as Record<string, unknown>[], concurrency, (item: Record<string, unknown>) => {
        return generateExportDispatches(prefixes.uriToUrl(prefix, item._id), prefix, options!.layout || false, concurrency);
      });
      dispatches = _.flatten(allDispatches);
      unprefixed = await mapConcurrent(dispatches, concurrency, (dispatch: Dispatch) => {
        return prefixes.remove(dispatch, prefix);
      });
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

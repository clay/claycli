import _ from 'lodash';

const yaml = require('js-yaml');
const split = require('split-lines');
const formatting = require('../formatting');
const prefixes = require('../prefixes');
const config = require('./config');
const rest = require('../rest');

type Dispatch = Record<string, unknown>;

interface ImportOptions {
  key?: string;
  yaml?: boolean;
  publish?: boolean;
}

interface ImportResult {
  type: string;
  message: string;
  details?: string;
}

/**
 * determine if url is a _uris route
 * these must be PUT as text, not json
 */
function isURI(url: string): boolean {
  return _.includes(url, 'uris/');
}

/**
 * send a single dispatch to Clay
 */
async function sendDispatchToClay(
  dispatch: Dispatch,
  prefix: string,
  key: string,
  options: ImportOptions
): Promise<ImportResult[]> {
  var rootURI = Object.keys(dispatch)[0],
    url = prefixes.uriToUrl(prefix, rootURI),
    data = dispatch[rootURI];

  var latestRes: ImportResult, pubRes: ImportResult, res: ImportResult, publishRes: ImportResult;

  if (isURI(url)) {
    return [await rest.put(url.replace(/\/$/, ''), data, { key, type: 'text' })];
  } else if (options.publish && _.includes(url, '@published')) {
    latestRes = await rest.put(url.replace('@published', ''), data, { key });
    pubRes = await rest.put(url, undefined, { key });
    return [latestRes, pubRes, { type: 'warning', message: 'Generated latest data for @published item', details: url }];
  } else if (options.publish) {
    res = await rest.put(url, data, { key });
    publishRes = await rest.put(`${url}@published`, undefined, { key });
    return [res, publishRes];
  }
  return [await rest.put(url, data, { key })];
}

/**
 * import a bootstrap into clay
 */
async function importBootstrap(
  obj: Record<string, unknown>,
  prefix: string,
  key: string,
  options: ImportOptions
): Promise<ImportResult[]> {
  var dispatches = formatting.toDispatch([obj]) as Dispatch[],
    results: ImportResult[] = [], i: number, prefixed: Dispatch, dispatchResults: ImportResult[];

  for (i = 0; i < dispatches.length; i++) {
    prefixed = await prefixes.add(dispatches[i], prefix);
    dispatchResults = await sendDispatchToClay(prefixed, prefix, key, options);
    results = results.concat(dispatchResults);
  }
  return results;
}

/**
 * import dispatch into clay
 */
async function importDispatch(
  obj: Dispatch,
  prefix: string,
  key: string,
  options: ImportOptions
): Promise<ImportResult[]> {
  var prefixed = await prefixes.add(obj, prefix);

  return sendDispatchToClay(prefixed, prefix, key, options);
}

/**
 * parse a source into lines for dispatch processing
 */
function parseDispatchSource(source: string | Buffer | Record<string, unknown>): unknown[] {
  if (_.isString(source)) {
    return source.split('\n').filter(Boolean);
  } else if (Buffer.isBuffer(source)) {
    return source.toString('utf8').split('\n').filter(Boolean);
  } else if (source && typeof (source as any).pipe === 'function') {
    // Streams are not supported in the async implementation
    throw new Error('Stream input is not supported. Please pipe content via stdin or pass a string/Buffer.');
  } else if (_.isObject(source)) {
    return [source];
  }
  return [];
}

/**
 * parse yaml bootstraps, splitting by duplicate root keys
 */
function parseYamlBootstraps(str: string): string[] {
  var lines = split(str, { preserveNewlines: true });

  return _.reduce(lines, (bootstraps: string[], line: string) => {
    var rootProps = [
      '_components:\n',
      '_pages:\n',
      '_users:\n',
      '_uris:\n',
      '_lists:\n',
      '_layouts:\n'
    ];

    if (_.includes(rootProps, line)) {
      bootstraps.push(line);
    } else {
      bootstraps[bootstraps.length - 1] += line;
    }
    return bootstraps;
  }, ['']);
}

/**
 * import yaml bootstraps
 */
async function importYaml(
  str: string,
  prefix: string,
  key: string,
  options: ImportOptions
): Promise<ImportResult[]> {
  var chunks: string[], results: ImportResult[] = [], i: number, bootstraps: string[],
    j: number, obj: Record<string, unknown>, bootstrapResults: ImportResult[];

  chunks = str.split(/\n==> .*? <==\n/ig).filter((chunk) => chunk && chunk !== '\n');
  for (i = 0; i < chunks.length; i++) {
    bootstraps = parseYamlBootstraps(chunks[i]);
    for (j = 0; j < bootstraps.length; j++) {
      if (!bootstraps[j] || !bootstraps[j].trim()) {
        continue;
      }
      try {
        obj = yaml.load(bootstraps[j]);
      } catch (e: unknown) {
        results.push({ type: 'error', message: `YAML syntax error: ${(e as Error).message.slice(0, (e as Error).message.indexOf(':'))}` });
        continue;
      }
      if (!obj) {
        continue;
      }
      bootstrapResults = await importBootstrap(obj, prefix, key, options);
      results = results.concat(bootstrapResults);
    }
  }
  return results;
}

/**
 * import json dispatches
 */
async function importJson(
  source: string | Buffer | Record<string, unknown>,
  prefix: string,
  key: string,
  options: ImportOptions
): Promise<ImportResult[]> {
  var items = parseDispatchSource(source),
    results: ImportResult[] = [], i: number, obj: unknown, dispatchResults: ImportResult[];

  for (i = 0; i < items.length; i++) {
    obj = items[i];
    if (_.isString(obj)) {
      try {
        obj = JSON.parse(obj);
      } catch (e: unknown) {
        try {
          yaml.load(obj as string);
          results.push({ type: 'error', message: 'Cannot import dispatch from yaml', details: 'Please use the --yaml argument to import from bootstraps' });
          continue;
        } catch (_otherE) {
          results.push({ type: 'error', message: `JSON syntax error: ${(e as Error).message}`, details: _.truncate(obj as string) });
          continue;
        }
      }
    }
    if ((obj as Record<string, unknown>).type && (obj as Record<string, unknown>).type === 'error') {
      results.push(obj as ImportResult);
    } else {
      dispatchResults = await importDispatch(obj as Dispatch, prefix, key, options);
      results = results.concat(dispatchResults);
    }
  }
  return results;
}

/**
 * import data into clay
 */
function importItems(
  str: string | Record<string, unknown> | Buffer,
  url: string,
  options?: ImportOptions
): Promise<ImportResult[]> {
  var key: string, prefix: string;

  options = options || {};
  key = config.get('key', options.key);
  prefix = config.get('url', url);

  if (!prefix) {
    return Promise.resolve([{ type: 'error', message: 'URL is not defined! Please specify a site prefix to import to' }]);
  }

  if (options.yaml) {
    return importYaml(_.isString(str) ? str : String(str), prefix, key, options);
  }
  return importJson(str, prefix, key, options);
}

/**
 * parse string of bootstraps,
 * returning prefixed dispatches
 */
async function parseBootstrapFn(str: string, url: string): Promise<Dispatch[]> {
  var prefix = config.get('url', url), obj: Record<string, unknown>,
    dispatches: Dispatch[], i: number, results: Dispatch[] = [];

  try {
    obj = yaml.load(str);
  } catch (e: unknown) {
    throw new Error(`YAML syntax error: ${(e as Error).message.slice(0, (e as Error).message.indexOf(':'))}`);
  }
  dispatches = formatting.toDispatch([obj]) as Dispatch[];
  for (i = 0; i < dispatches.length; i++) {
    results.push(await prefixes.add(dispatches[i], prefix));
  }
  return results;
}

/**
 * parse string of dispatches,
 * returning prefixed dispatches
 */
async function parseDispatchFn(str: string, url: string): Promise<Dispatch[]> {
  var prefix = config.get('url', url),
    lines = str.split('\n').filter(Boolean),
    results: Dispatch[] = [], i: number, obj: Record<string, unknown>;

  for (i = 0; i < lines.length; i++) {
    try {
      obj = JSON.parse(lines[i]);
    } catch (e: unknown) {
      throw new Error(`JSON parser error: ${(e as Error).message}`);
    }
    results.push(await prefixes.add(obj, prefix));
  }
  return results;
}

/**
 * parse a json bootstrap object
 * returning prefixed dispatches
 */
async function parseBootstrapObjectFn(obj: Record<string, unknown>, url: string): Promise<Dispatch[]> {
  var prefix = config.get('url', url),
    dispatches = formatting.toDispatch([obj]) as Dispatch[],
    results: Dispatch[] = [], i: number;

  for (i = 0; i < dispatches.length; i++) {
    results.push(await prefixes.add(dispatches[i], prefix));
  }
  return results;
}

// Mixed default + named export pattern: module.exports = fn + module.exports.prop = val
export = Object.assign(importItems, {
  parseBootstrap: parseBootstrapFn,
  parseDispatch: parseDispatchFn,
  parseBootstrapObject: parseBootstrapObjectFn
});

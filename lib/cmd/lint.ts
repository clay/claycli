import _ from 'lodash';

const utils = require('clayutils');
const yaml = require('js-yaml');
const config = require('./config');
const prefixes = require('../prefixes');
const rest = require('../rest');
const { mapConcurrent } = require('../concurrency');

const refProp = '_ref';

interface LintResult {
  type: string;
  message?: string;
  details?: string;
}

/**
 * expand references in component lists
 */
function expandListReferences(val: unknown[]): string[] {
  if (_.has(_.head(val), refProp)) {
    // component list! return the references
    return _.map(val, (item) => (item as Record<string, unknown>)[refProp]) as string[];
  } else {
    return [];
  }
}

/**
 * expand references in component properties
 */
function expandPropReferences(val: Record<string, unknown>): string[] {
  if (_.has(val, refProp)) {
    return [val[refProp] as string];
  } else {
    return [];
  }
}

/**
 * list all references in a component
 */
function listComponentReferences(data: Record<string, unknown>): string[] {
  return _.reduce(data, (result: string[], val) => {
    if (_.isArray(val)) {
      return result.concat(expandListReferences(val));
    } else if (_.isObject(val)) {
      return result.concat(expandPropReferences(val as Record<string, unknown>));
    } else {
      return result;
    }
  }, []);
}

/**
 * recursively check children
 */
async function checkChildren(
  children: string[],
  prefix: string,
  concurrency: number,
  ext: string
): Promise<LintResult[]> {
  var allResults: LintResult[][] = await mapConcurrent(children, concurrency, (child: string) => {
    return checkComponent(child, prefix, concurrency, ext);
  });

  return _.flatten(allResults);
}

/**
 * check a broken component (composed json failed)
 */
async function checkBrokenComponent(
  url: string,
  prefix: string,
  concurrency: number,
  ext: string
): Promise<LintResult[]> {
  var dataRes: unknown, children: string[], childResults: LintResult[];

  dataRes = await rest.get(url);
  if (dataRes instanceof Error) {
    return [{ type: 'error', message: (dataRes as Error & { url?: string }).url || '' }];
  }
  children = listComponentReferences(dataRes as Record<string, unknown>);
  childResults = await checkChildren(children, prefix, concurrency, ext);
  return ([{ type: 'success', message: url }] as LintResult[]).concat(childResults);
}

/**
 * check a component whose rendered version is broken
 */
async function checkBrokenRender(
  url: string,
  prefix: string,
  concurrency: number,
  ext: string
): Promise<LintResult[]> {
  var dataRes: unknown, children: string[], results: LintResult[], childResults: LintResult[];

  dataRes = await rest.get(url);
  if (dataRes instanceof Error) {
    return [{ type: 'error', message: (dataRes as Error & { url?: string }).url || '' }];
  }
  children = listComponentReferences(dataRes as Record<string, unknown>);
  results = [
    { type: 'error', message: `${url}${ext}` },
    { type: 'success', message: url }
  ];
  childResults = await checkChildren(children, prefix, concurrency, ext);
  return results.concat(childResults);
}

/**
 * check a component whose composed json is OK but has an extension to verify
 */
async function checkRendered(
  url: string,
  prefix: string,
  concurrency: number,
  ext: string
): Promise<LintResult[]> {
  var renderRes = await rest.get(`${url}${ext}`, { type: 'text' });

  if (renderRes instanceof Error) {
    return checkBrokenRender(url, prefix, concurrency, ext);
  }
  return [{ type: 'success', message: `${url}${ext}` }];
}

/**
 * normalize a url/uri input, extracting extension if present
 */
function normalizeComponentUrl(
  url: unknown,
  prefix: string,
  ext: string
): { url?: string; ext?: string; passthrough?: unknown[] } {
  ext = ext || '';
  if (_.isObject(url)) {
    return { passthrough: [url] };
  } else if (_.isString(url) && !_.includes(url, 'http')) {
    url = prefixes.uriToUrl(prefix, url);
  }

  if (!ext.length && _.isString(url) && prefixes.getExt(url)) {
    ext = prefixes.getExt(url);
    url = (url as string).slice(0, (url as string).indexOf(ext));
  }
  return { url: url as string, ext };
}

/**
 * recursively check all references in a component or layout
 */
async function checkComponent(
  url: unknown,
  prefix: string,
  concurrency: number,
  ext?: string
): Promise<LintResult[]> {
  var normalized = normalizeComponentUrl(url, prefix, ext || ''),
    composedRes: unknown;

  if (normalized.passthrough) {
    return normalized.passthrough as LintResult[];
  }
  url = normalized.url;
  ext = normalized.ext;

  composedRes = await rest.get(`${url}.json`);
  if (composedRes instanceof Error) {
    return checkBrokenComponent(url as string, prefix, concurrency, ext!);
  } else if (ext!.length) {
    return checkRendered(url as string, prefix, concurrency, ext!);
  }
  return [{ type: 'success', message: `${url}${ext}` }];
}

/**
 * check broken page (composed json failed)
 */
async function checkPageBroken(
  url: string,
  prefix: string,
  concurrency: number,
  ext: string
): Promise<LintResult[]> {
  var dataRes: unknown, layout: string, children: string[], results: LintResult[], childResults: LintResult[];

  dataRes = await rest.get(url);
  if (dataRes instanceof Error) {
    return [{ type: 'error', message: (dataRes as Error & { url?: string }).url || '' }];
  }
  layout = (dataRes as Record<string, unknown>).layout as string;
  children = _.reduce(dataRes as Record<string, unknown>, (uris: string[], area: unknown) => _.isArray(area) ? uris.concat(area) : uris, []);
  children.unshift(layout);
  results = [{ type: 'success', message: url }];
  childResults = await checkChildren(children, prefix, concurrency, ext);
  return results.concat(childResults);
}

/**
 * check broken page render
 */
async function checkPageBrokenRender(
  url: string,
  prefix: string,
  concurrency: number,
  ext: string
): Promise<LintResult[]> {
  var dataRes: unknown, layout: string, children: string[], results: LintResult[], childResults: LintResult[];

  dataRes = await rest.get(url);
  if (dataRes instanceof Error) {
    return [{ type: 'error', message: (dataRes as Error & { url?: string }).url || '' }];
  }
  layout = (dataRes as Record<string, unknown>).layout as string;
  children = _.reduce(dataRes as Record<string, unknown>, (uris: string[], area: unknown) => _.isArray(area) ? uris.concat(area) : uris, []);
  children.unshift(layout);
  results = [
    { type: 'error', message: `${url}${ext}` },
    { type: 'success', message: url }
  ];
  childResults = await checkChildren(children, prefix, concurrency, ext);
  return results.concat(childResults);
}

/**
 * check all references in a page
 */
async function checkPage(url: string, prefix: string, concurrency: number): Promise<LintResult[]> {
  var ext = '', composedRes: unknown, renderRes: unknown;

  if (_.isString(url) && prefixes.getExt(url)) {
    ext = prefixes.getExt(url);
    url = url.slice(0, url.indexOf(ext));
  }

  composedRes = await rest.get(`${url}.json`);
  if (composedRes instanceof Error) {
    return checkPageBroken(url, prefix, concurrency, ext);
  } else if (ext.length) {
    renderRes = await rest.get(`${url}${ext}`, { type: 'text' });
    if (renderRes instanceof Error) {
      return checkPageBrokenRender(url, prefix, concurrency, ext);
    }
    return [{ type: 'success', message: `${url}${ext}` }];
  }
  return [{ type: 'success', message: url }];
}

/**
 * determine the page uri, then run checks against it
 */
async function checkPublicUrl(url: string, concurrency: number): Promise<LintResult[]> {
  var result: { uri: string; prefix: string }, pageURL: string, pageResults: LintResult[];

  try {
    result = await rest.findURI(url);
    pageURL = prefixes.uriToUrl(result.prefix, result.uri);
    pageResults = await checkPage(`${pageURL}.html`, result.prefix, concurrency);
    return ([{ type: 'success', message: url }] as LintResult[]).concat(pageResults);
  } catch (e: unknown) {
    return [{ type: 'error', message: (e as { url?: string }).url || '' }];
  }
}

/**
 * lint a url, recursively determining if all components exist
 */
function lintUrl(rawUrl: string, options?: { concurrency?: number }): Promise<LintResult[]> {
  var concurrency: number, url: string;

  options = options || {};
  concurrency = options.concurrency || 10;
  url = config.get('url', rawUrl);

  if (!url) {
    return Promise.resolve([{ type: 'error', message: 'URL is not defined! Please specify a url to lint' }]);
  }

  if (utils.isComponent(url) || utils.isLayout(url)) {
    return checkComponent(url, prefixes.getFromUrl(url), concurrency);
  } else if (utils.isPage(url)) {
    return checkPage(url, prefixes.getFromUrl(url), concurrency);
  } else {
    return checkPublicUrl(url, concurrency);
  }
}

/**
 * determine if a schema has a description
 */
function noDescription(obj: Record<string, unknown>): boolean {
  return !_.has(obj, '_description');
}

/**
 * Check if a string contains non-letter, non-number, or non-underscore chars
 */
function isValidKilnDotNotation(str: string): boolean {
  return !/[^\w\$_]/g.test(str);
}

/**
 * determine if a schema has camelCased props
 */
function nonCamelCasedProps(obj: Record<string, unknown>): string[] {
  return _.reduce(obj, (errors: string[], value: unknown, key: string) => {
    return !isValidKilnDotNotation(key) ? errors.concat(key) : errors;
  }, []);
}

/**
 * determine if a schema has groups that reference non-existant fields
 */
function nonexistentGroupFields(obj: Record<string, unknown>): string[] {
  return _.reduce(_.get(obj, '_groups') as Record<string, { fields: string[] }> | undefined, (errors: string[], group, groupName) => {
    const fields = group.fields;

    _.each(fields, (field: string) => {
      if (!_.has(obj, field)) {
        errors.push(`${groupName} \u00BB ${field}`);
      }
    });
    return errors;
  }, []);
}

/**
 * lint schemas for:
 * - valid yaml syntax
 * - has _description
 * - all root-level properties are camelCase
 * - _group fields refer to existing properties
 */
function lintSchema(str: string): Promise<LintResult[]> {
  var obj: Record<string, unknown>, errors: LintResult[];

  try {
    obj = yaml.load(str);
  } catch (e: unknown) {
    return Promise.resolve([{ type: 'error', message: `YAML syntax error: ${(e as Error).message.slice(0, (e as Error).message.indexOf(':'))}` }]);
  }

  errors = [];
  if (noDescription(obj)) {
    errors.push({ type: 'error', message: 'Schema has no _description' });
  }
  if (nonCamelCasedProps(obj).length) {
    errors.push({ type: 'error', message: 'Properties must be camelCased', details: nonCamelCasedProps(obj).join('\n') });
  }
  if (nonexistentGroupFields(obj).length) {
    errors.push({ type: 'error', message: 'Fields referenced by groups don\'t exist', details: nonexistentGroupFields(obj).join('\n') });
  }

  if (errors.length) {
    return Promise.resolve(errors);
  }
  return Promise.resolve([{ type: 'success' }]);
}

export { lintUrl, lintSchema };

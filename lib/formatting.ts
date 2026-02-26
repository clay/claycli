import _ from 'lodash';

const utils = require('clayutils');
const composer = require('./composer');
import deepReduce = require('./deep-reduce');
import types = require('./types');

type Dispatch = Record<string, unknown>;

interface BootstrapContext {
  bootstrap: Record<string, unknown>;
  added: Record<string, unknown>;
}

interface User {
  username: string;
  provider: string;
  auth: string;
  [key: string]: unknown;
}

interface Page {
  url?: string;
  customUrl?: string;
  meta?: Record<string, unknown>;
  [key: string]: unknown;
}

/**
 * get uri from dispatch
 */
function getDispatchURI(dispatch: Dispatch): string {
  return Object.keys(dispatch)[0];
}

/**
 * create dispatches from component defaults and instances,
 * then deduplicate if any child components have dispatches of their own already
 */
function parseComponentBootstrap(
  dispatches: Dispatch[],
  components: Record<string, Record<string, unknown>>,
  { bootstrap, added }: BootstrapContext
): Dispatch[] {
  return _.reduce(components, (dispatches: Dispatch[], data, name) => {
    const defaultData = _.omit(data, 'instances'),
      defaultURI = `/_components/${name}`;

    // first, compose and add the default data if it hasn't already been added
    if (_.size(defaultData) && !(added as Record<string, boolean>)[defaultURI]) {
      dispatches.push({ [defaultURI]: composer.denormalize(defaultData, bootstrap, added) });
      (added as Record<string, boolean>)[defaultURI] = true;
    }

    // second, compose and add instances if they haven't already been added
    if (data.instances && _.size(data.instances)) {
      _.forOwn(data.instances as Record<string, unknown>, (instanceData, instance) => {
        const instanceURI = `/_components/${name}/instances/${instance}`;

        if (!(added as Record<string, boolean>)[instanceURI]) {
          dispatches.push({ [instanceURI]: composer.denormalize(instanceData, bootstrap, added) });
          (added as Record<string, boolean>)[instanceURI] = true;
        }
      });
    }

    // then remove any dispatches that are actually children of other components
    return _.filter(dispatches, (dispatch) => !_.get(added, `asChild[${getDispatchURI(dispatch)}]`));
  }, dispatches);
}

/**
 * create dispatches from layout defaults and instances
 */
function parseLayoutBootstrap(
  dispatches: Dispatch[],
  layouts: Record<string, Record<string, unknown>>,
  { bootstrap, added }: BootstrapContext
): Dispatch[] {
  return _.reduce(layouts, (dispatches: Dispatch[], data, name) => {
    const defaultData = _.omit(data, 'instances'),
      defaultURI = `/_layouts/${name}`;

    // first, compose and add the default data if it hasn't already been added
    if (_.size(defaultData)) {
      dispatches.push({ [defaultURI]: composer.denormalize(defaultData, bootstrap, added) });
    }

    // second, compose and add instances if they haven't already been added
    if (data.instances && _.size(data.instances)) {
      _.forOwn(data.instances as Record<string, unknown>, (rawInstanceData, instance) => {
        const instanceURI = `/_layouts/${name}/instances/${instance}`;
        const instanceData = rawInstanceData as Record<string, unknown>;

        let meta: Record<string, unknown> | undefined;

        // parse out metadata
        if (instanceData.meta) {
          meta = instanceData.meta as Record<string, unknown>;
          delete instanceData.meta;
        }

        dispatches.push({ [instanceURI]: composer.denormalize(instanceData, bootstrap, added) });
        if (meta) {
          dispatches.push({ [`${instanceURI}/meta`]: meta });
        }
      });
    }

    return dispatches;
  }, dispatches);
}

/**
 * create dispatches from page data
 * note: these pages are not composed
 */
function parsePageBootstrap(dispatches: Dispatch[], pages: Record<string, Page>): Dispatch[] {
  return _.reduce(pages, (dispatches: Dispatch[], page, id) => {
    let meta: Record<string, unknown> | undefined;

    if (id[0] === '/') {
      // if a page starts with a slash, remove it so we can generate the uri
      id = id.slice(1);
    }

    // unpublished pages should not have 'url', but rather 'customUrl'
    if (page.url && !page.customUrl) {
      page.customUrl = page.url;
      delete page.url; // don't pass this through
    }

    // parse out metadata
    if (page.meta) {
      meta = page.meta;
      delete page.meta;
    }

    dispatches.push({ [`/_pages/${id}`]: page });
    // add meta dispatch _after_ page data
    if (meta) {
      dispatches.push({ [`/_pages/${id}/meta`]: meta });
    }
    return dispatches;
  }, dispatches);
}

/**
 * create dispatches from users
 */
function parseUsersBootstrap(dispatches: Dispatch[], users: User[]): Dispatch[] {
  // note: dispatches match 1:1 with users
  return _.reduce(users, (dispatches: Dispatch[], user) => {
    if (!user.username || !user.provider || !user.auth) {
      throw new Error('Cannot bootstrap users without username, provider, and auth level');
    } else {
      dispatches.push({ [`/_users/${Buffer.from(user.username.toLowerCase() + '@' + user.provider).toString('base64')}`]: user });
    }
    return dispatches;
  }, dispatches);
}

/**
 * parse uris, lists, etc arbitrary data in bootstraps
 */
function parseArbitraryBootstrapData(
  dispatches: Dispatch[],
  items: Record<string, unknown>,
  type: string
): Dispatch[] {
  return _.reduce(items, (dispatches: Dispatch[], item, key) => {
    if (key[0] === '/') {
      // fix for uris, which sometimes start with /
      key = key.slice(1);
    }
    dispatches.push({ [`/${type}/${key}`]: item });
    return dispatches;
  }, dispatches);
}

/**
 * compose bootstrap data
 */
function parseBootstrap(bootstrap: Record<string, unknown>): Dispatch[] {
  const added: Record<string, unknown> = { asChild: {} },
    dispatches: Dispatch[] = _.reduce(bootstrap, (dispatches: Dispatch[], items: unknown, type: string) => {
      switch (type) {
        case '_components': return parseComponentBootstrap(dispatches, items as Record<string, Record<string, unknown>>, { bootstrap, added });
        case '_layouts': return parseLayoutBootstrap(dispatches, items as Record<string, Record<string, unknown>>, { bootstrap, added });
        case '_pages': return parsePageBootstrap(dispatches, items as Record<string, Page>);
        case '_users': return parseUsersBootstrap(dispatches, items as User[]);
        default: return parseArbitraryBootstrapData(dispatches, items as Record<string, unknown>, type); // uris, lists
      }
    }, []);

  return dispatches;
}

/**
 * convert array of bootstrap objects to dispatches
 */
function toDispatch(items: Record<string, unknown>[]): Dispatch[] {
  return _.flatMap(items, parseBootstrap);
}

/**
 * add deep component data to a bootstrap
 */
function parseComponentDispatch(
  uri: string,
  dispatch: Dispatch,
  bootstrap: Record<string, unknown>
): Record<string, unknown> {
  const deepData = dispatch[uri] as Record<string, unknown>,
    name = utils.getComponentName(uri),
    instance = utils.getComponentInstance(uri),
    componentPath = instance ? `_components['${name}'].instances['${instance}']` : `_components['${name}']`;

  _.set(bootstrap, componentPath, composer.normalize(deepData));

  return deepReduce(bootstrap, deepData, (ref: string, val: Record<string, unknown>) => {
    const deepName = utils.getComponentName(ref),
      deepInstance = utils.getComponentInstance(ref),
      deepPath = deepInstance ? `_components['${deepName}'].instances['${deepInstance}']` : `_components['${deepName}']`;

    _.set(bootstrap, deepPath, composer.normalize(val));
  });
}

/**
 * add deep layout data to a bootstrap
 */
function parseLayoutDispatch(
  uri: string,
  dispatch: Dispatch,
  bootstrap: Record<string, unknown>
): Record<string, unknown> {
  const deepData = dispatch[uri] as Record<string, unknown>,
    name = utils.getLayoutName(uri),
    instance = utils.getLayoutInstance(uri),
    layoutPath = instance ? `_layouts['${name}'].instances['${instance}']` : `_layouts['${name}']`;

  if (utils.isLayoutMeta(uri)) {
    // if we're just setting metadata, return early
    // note: only instances can have metadata
    _.set(bootstrap, `_layouts['${name}'].instances['${instance}'].meta`, deepData);
    return bootstrap;
  }

  _.set(bootstrap, layoutPath, _.assign({}, _.get(bootstrap, layoutPath, {}), composer.normalize(deepData)));

  return deepReduce(bootstrap, deepData, (ref: string, val: Record<string, unknown>) => {
    // reduce on the child components and their instances
    const deepName = utils.getComponentName(ref),
      deepInstance = utils.getComponentInstance(ref),
      deepPath = deepInstance ? `_components['${deepName}'].instances['${deepInstance}']` : `_components['${deepName}']`;

    _.set(bootstrap, deepPath, _.assign({}, _.get(bootstrap, deepPath, {}), composer.normalize(val)));
  });
}

/**
 * add page data to a bootstrap
 */
function parsePageDispatch(
  uri: string,
  dispatch: Dispatch,
  bootstrap: Record<string, unknown>
): Record<string, unknown> {
  const id = utils.getPageInstance(uri),
    page = dispatch[uri] as Page;

  if (utils.isPageMeta(uri)) {
    // if we're just setting metadata, return early
    _.set(bootstrap, `_pages['${id}'].meta`, page);
    return bootstrap;
  }

  // unpublished pages should not have 'url', but rather 'customUrl'
  if (page.url && !page.customUrl) {
    page.customUrl = page.url;
    delete page.url; // don't pass this through
  }

  _.set(bootstrap, `_pages['${id}']`, _.assign({}, _.get(bootstrap, `_pages['${id}']`, {}), page));
  return bootstrap;
}

/**
 * add user data to a bootstrap
 */
function parseUsersDispatch(
  uri: string,
  dispatch: Dispatch,
  bootstrap: Record<string, unknown>
): Record<string, unknown> {
  if (!bootstrap._users) {
    bootstrap._users = [];
  }

  (bootstrap._users as unknown[]).push(dispatch[uri]);
  return bootstrap;
}

/**
 * add uris, lists, etc arbitrary data to a bootstrap
 */
function parseArbitraryDispatchData(
  uri: string,
  dispatch: Dispatch,
  bootstrap: Record<string, unknown>
): Record<string, unknown> {
  let type = _.find(types, (t) => _.includes(uri, t)) as string,
    name = uri.split(`${type}/`)[1];

  type = type.slice(1); // remove beginning slash
  if (type === '_uris' && name[0] !== '/') {
    // fix for uris, which sometimes start with /
    name = `/${name}`;
  }

  _.set(bootstrap, `${type}['${name}']`, dispatch[uri]);
  return bootstrap;
}

/**
 * generate a bootstrap by reducing through a stream of dispatches
 */
function generateBootstrap(bootstrap: Record<string, unknown>, dispatch: Dispatch): Record<string, unknown> {
  const uri = getDispatchURI(dispatch),
    type = _.find(types, (t) => _.includes(uri, t));

  switch (type) {
    case '/_components': return parseComponentDispatch(uri, dispatch, bootstrap);
    case '/_layouts': return parseLayoutDispatch(uri, dispatch, bootstrap);
    case '/_pages': return parsePageDispatch(uri, dispatch, bootstrap);
    case '/_users': return parseUsersDispatch(uri, dispatch, bootstrap);
    default: return parseArbitraryDispatchData(uri, dispatch, bootstrap); // uris, lists
  }
}

/**
 * convert array of dispatches to a bootstrap
 */
function toBootstrap(dispatches: Dispatch[]): Record<string, unknown> {
  return dispatches.reduce(generateBootstrap, {});
}

export { toDispatch, toBootstrap };

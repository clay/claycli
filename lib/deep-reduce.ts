import _ from 'lodash';

const clayUtils = require('clayutils');

const refProp = '_ref';
const ignoredKeys: string[] = [
  '_components',
  '_componentSchemas',
  '_pageData',
  '_layoutRef',
  refProp,
  '_self',
  'blockParams',
  'filename',
  'knownHelpers',
  'locals',
  'media',
  'site',
  'state',
  'template'
];

type ComponentTree = Record<string, unknown> | unknown[] | unknown;
type ReduceFn = (ref: string, data: Record<string, unknown>) => void;

/**
 * deeply reduce a tree of components
 */
function deepReduce(
  result: Record<string, unknown>,
  tree: ComponentTree,
  fn: ReduceFn
): Record<string, unknown> {
  if (
    _.isObject(tree) &&
    !_.isArray(tree) &&
    (tree as Record<string, unknown>)[refProp] &&
    clayUtils.isComponent((tree as Record<string, unknown>)[refProp])
  ) {
    // we found a component!
    fn(
      (tree as Record<string, unknown>)[refProp] as string,
      tree as Record<string, unknown>
    );
  }

  if (_.isArray(tree)) {
    // check for arrays first
    _.each(tree, (item) => deepReduce(result, item, fn));
  } else if (_.isObject(tree)) {
    // then check for objects
    _.forOwn(tree as Record<string, unknown>, function (val, key) {
      if (_.head(key) !== '_' && !_.includes(ignoredKeys, key)) {
        // don't iterate through any metadata
        deepReduce(result, val, fn);
      }
    });
  }
  return result;
}

export = deepReduce;

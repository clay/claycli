'use strict';
const _ = require('lodash');

// convert dispatches to bootstraps, and vice versa
// dispatch looks like: {"/_components/article/instances/foo":{"title":"My Article","content": [{"_ref":"/_components/paragraph/instances/bar","text":"lorem ipsum"}]}}
// bootstrap looks like:
// _components:
//   article:
//     instances:
//       foo:
//         title: My Article
//         content:
//           - _ref: /_components/paragraph/instances/bar
//   paragraph:
//     instances:
//       bar:
//         text: lorem ipsum

function compose(data, results, root) {
  // todo: write a two-dimensional reducer that adds composed component data to the rootItems
  // while also checking to see if something is contained within ANOTHER component/page/etc
  // note: this might need two passes
}

function parseComponents(items, results, root) {
  return _.reduce(items, (results, data, name) => {
    const defaultData = _.omit(data, 'instances'),
      defaultURI = `/_components/${name}`;

    if (_.size(defaultData) && !results.checkedItems[defaultURI]) {
      results.checkedItems[defaultURI] = true;
      results.rootItems[defaultURI] = compose(data, results, root);
    }

    if (data.instances && _.size(data.instances)) {
      return _.reduce(data.instances, (results, instanceData, instanceID) => {
        const instanceURI = `/_components/${name}/instances/${instanceID}`;

        if (!results.checkedItems[instanceURI]) {
          results.checkedItems[instanceURI] = true;
          results.rootItems[instanceURI] = compose(data, results, root);
        }
      }, results);
    }
  }, results);
}

/**
 * convert stream of bootstrap objects to dispatches
 * @param  {Stream} stream
 * @return {Stream}
 */
function toDispatch(stream) {
  return stream.map((bootstrap) => {
    let { rootItems, checkedItems } = _.reduce(bootstrap, (results, items, type) => {
      switch (type) {
        case '_components': return parseComponents(items, results, bootstrap);
        // case '_pages': return parsePages(items, results, bootstrap);
        // case '_users': return parseUsers(items, results, bootstrap);
        // case '_uris': return parseUris(items, results, bootstrap);
        // case '_lists': return parseLists(items, results, bootstrap);
        default: return results;
      }
    }, { rootItems: {}, checkedItems: {} });

    console.log(rootItems);
    return rootItems;
  });
}

module.exports.toDispatch = toDispatch;

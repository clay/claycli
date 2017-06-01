const _ = require('lodash'),
  path = require('path'),
  fs = require('fs-extra'),
  yaml = require('js-yaml'),
  h = require('highland'),
  types = [
    'uris',
    'pages',
    'lists',
    'users'
  ];

function saveBootstrap(filename) {
  return (chunks) => {
    const bootstrapObj = _.reduce(chunks, (obj, chunk) => {
      // note: this naturally dedupes any duplicated components
      const uri = Object.keys(chunk)[0],
        data = chunk[uri],
        parts = uri.split('/'),
        type = parts[1]; // first thing after opening slash

      if (type === 'components' && _.includes(uri, '/instances')) { // component instance!
        const name = parts[2],
          id = parts[4];

        _.set(obj, `components[${name}].instances[${id}]`, data);
      } else if (type === 'components') { // component default data
        const name = parts[2],
          instances = _.get(obj, `components[${name}].instances`),
          objToMerge = instances ? { instances } : {}; // grab instances if they've already been added

        _.set(obj, `components[${name}]`, _.assign({}, data, objToMerge));
      } else if (_.includes(types, type)) { // some other type
        const id = parts[2]; // the string after the type will be the ID for other types

        _.set(obj, `${type}[${id}]`, data);
      }
      return obj;
    }, {});

    if (path.extname(filename) === '.json') {
      // write to a json file (creating directory if it doesn't exist)
      return h(fs.outputJson(filename, bootstrapObj)
        .then(() => ({ result: 'success', filename }))
        .catch((e) => ({ result: 'error', filename, message: e.message })));
    } else {
      // write to yaml file (creating directory if it doesn't exist)
      // note: will add .yml extension if you didn't specify an extension
      filename = path.extname(filename) ? filename : `${filename}.yml`;
      return h(fs.outputFile(filename, yaml.safeDump(bootstrapObj))
        .then(() => ({ result: 'success', filename }))
        .catch((e) => ({ result: 'error', filename, message: e.message })));
    }
  };
}

module.exports.saveBootstrap = saveBootstrap;

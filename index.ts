// programmatic api

const api = {
  config: require('./lib/cmd/config'),
  lint: require('./lib/cmd/lint'),
  import: require('./lib/cmd/import'),
  export: require('./lib/cmd/export'),
  compile: require('./lib/cmd/compile'),
  gulp: require('gulp'), // A reference to the Gulp instance so that external tasks can reference a common package
  mountComponentModules: require('./lib/cmd/pack/mount-component-modules'),
  getWebpackConfig: require('./lib/cmd/pack/get-webpack-config')
};

export = api;

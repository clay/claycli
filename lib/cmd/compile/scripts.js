'use strict';
const _ = require('lodash'),
  afs = require('amphora-fs'),
  fs = require('fs-extra'),
  path = require('path'),
  h = require('highland'),
  glob = require('glob'),
  chokidar = require('chokidar'),
  // gulp, gulp plugins, and deps
  gulp = require('gulp'),
  changed = require('gulp-changed'),
  es = require('event-stream'),
  // browserify / megabundler deps
  browserify = require('browserify'),
  browserifyCache = require('browserify-cache-api'),
  babelify = require('babelify'),
  through2 = require('through2'),
  browserifyExtractRegistry = require('browserify-extract-registry'),
  browserifyExtractIds = require('browserify-extract-ids'),
  browserifyGlobalPack = require('browserify-global-pack'),
  bundleCollapser = require('bundle-collapser/plugin'),
  helpers = require('../../compilation-helpers'),
  // globbing patterns
  kilnGlob = './node_modules/clay-kiln/dist/clay-kiln-@(edit|view).js',
  kilnPluginsGlob = 'services/kiln/*!(.test).js',
  modelGlobs = afs.getComponents().map((comp) => ({ name: comp, path: path.join(afs.getComponentPath(comp), 'model.js') })),
  clientGlobs = afs.getComponents().map((comp) => ({ name: comp, path: path.join(afs.getComponentPath(comp), 'client.js') })),
  // destination paths
  destPath = path.resolve(process.cwd(), 'public', 'js'),
  registryPath = path.resolve(destPath, 'registry.json'),
  idsPath = path.resolve(destPath, 'ids.json'),
  clientEnvPath = path.resolve(process.cwd(), 'client-env.json'), // make sure this is .gitignored!
  browserifyCachePath = path.resolve(process.cwd(), 'browserify-cache.json'), // make sure this is gitignored!
  kilnPluginCSSDestPath = path.resolve(process.cwd(), 'public', 'css'), // different from the script destinations
  variables = {
    // these arguments allow setting default env variables
    minify:  process.env.CLAYCLI_COMPILE_MINIFIED || ''
  },
  babelConfig = {
    presets: ['es2015'],
    plugins: ['transform-es2015-modules-commonjs']
  },
  temporaryIDs = {};

/**
 * copy kiln js if it has changed
 * note: kiln compiles its own js, so this just copies it to the public folder
 * where it can be served
 * @return {Stream}
 */
function buildKiln() {
  return h(gulp.src(kilnGlob)
    .pipe(changed(destPath, { hasChanged: helpers.hasChanged }))
    .pipe(gulp.dest(destPath))
    .pipe(es.mapSync((file) => ({ type: 'success', message: file.path }))));
}

/**
 * for a given file, return its module IDs
 * @param {string} file absolute file path
 * @return {string|undefined} module id
 */
function getModuleId(file) {
  const name = file.split('/').slice(-2)[0];

  if (_.endsWith(file, 'client.js')) {
    return `${name}.client`;
  } else if (_.endsWith(file, 'model.js')) {
    return `${name}.model`;
  } // else it uses an incremented number
}

/**
* returns a function that retrieves a module ID for a specified file.
* defers to IDs in cachedIds if set.
* @param {Object} [opts]
* @param {boolean} [opts.minimal] Make all IDs reflect source file paths
* @param {Object} [opts.cachedIds] Map of file paths to previously generated IDs
* @return {function} A function that returns an ID given a specified file
**/
function idGenerator({ cachedIds }) {
  const generatedIds = _.assign({}, cachedIds);
  // set to the highest number in the generateIds, or 1
  let i = _.max(_.values(generatedIds).filter(_.isFinite)) + 1 || 1;

  return (file) => {
    let id = generatedIds[file] || (generatedIds[file] = getModuleId(file) || i++);

    temporaryIDs[id] = file;
    return id;
  };
}

/**
 * browserify plugin to assign module IDs to each module, replacing browserify's
 * built-in labeler. ensures existing modules are assigned their current IDs.
 * @param {object} b
 * @param {object} [opts]
 * @param {object} [opts.ids] mapping of current filenames to module IDs
 * @returns {object} browserify plugin
 */
function labeler(b, { cachedIds = {} }) {
  const getOrGenerateId = idGenerator({ cachedIds });

  return b.pipeline.get('label')
    .splice(0, 1, through2.obj((item, enc, cb) => {
      item.id = getOrGenerateId(item.id);
      item.deps = _.mapValues(item.deps, (val, key) =>
        key === 'dup' ? val : getOrGenerateId(val));
      cb(null, item);
    }));
}

/**
 * browserify plugin to filter out any modules with source files that appear
 * in a specified array, EXCEPT entry files
 * @param {object} b
 * @param {object} [opts]
 * @param {string[]} [opts.cachedFiles] array of cached source files
 */
function filterUnchanged(b, { cachedFiles = [] }) {
  const entries = [];

  // collect entry files
  b.pipeline.get('record').push(through2.obj(function (item, enc, cb) {
    entries.push(item.file);
    cb(null, item);
  }));

  b.pipeline.get('deps').push(through2.obj(function (item, enc, cb) {
    if (_.includes(cachedFiles, item.file) && !_.includes(entries, item.file)) {
      cb();
    } else {
      cb(null, item);
    }
  }));
}

/**
 * for a given dependency, return the path(s) of the output file(s)
 * if the files already exist, the module will be appended to them
 * if this returns an array, the module is exported to multiple files
 * @param  {string} prefix e.g. '_client-deps'
 * @return {Function} that is passed deps
 */
function getOutfile(prefix) {
  return (dep) => {
    const id = dep.id;

    if (_.includes(['prelude', 'postlude'], id)) {
      return path.join(destPath, `_${id}.js`); // add underscore before these
    } else if (_.endsWith(id, '.model')) {
      // model.js files are compiled to <name>.model.js and _models-<letter>-<letter>.js
      return [
        path.join(destPath, `${id}.js`),
        path.join(destPath, `_models-${helpers.bucket(id)}.js`)
      ];
    } else if (_.isFinite(parseInt(id))) {
      const name = _.isString(temporaryIDs[id]) && path.basename(temporaryIDs[id], '.js');

      // deps get put into <number>.js and <prefix>-<letter>-<letter>.js
      // e.g. _client-deps-a-d.js or _model-deps-q-t.js
      return [
        path.join(destPath, `${id}.js`),
        path.join(destPath, `${prefix}-${helpers.bucket(name)}.js`)
      ];
    } else {
      // client.js files are compiled to <name>.client.js
      return path.join(destPath, `${id}.js`);
    }
  };
}

/**
 * compile, dedupe, and bundle client.js and their deps
 * @param {string|string[]} [entries]
 * @param {object} [options] passed through when doing incremental builds
 * @param {boolean} [options.minify]
 * @param {object} [options.cache] used to track data between builds so we don't need to do full rebuild on each change
 * @param {object} [options.cache.ids] map of absolute source file paths to module IDs
 * @param {object} [options.cache.registry] dependency registry, maps each module ID to an array of dependency IDs
 * @param {string[]} [options.cache.files] array of all source files represented in the megabundle
 * @return {Stream}
 */
function buildViewModeScripts(entries, options = {}) {
  const bundler = browserify({
      dedupe: false,
      // cache and packageCache are used by browserify-cache-api to speed up full rebuilds
      cache: {},
      packageCache: {}
    }),
    subcache = {
      ids: {},
      registry: {},
      files: []
    };

  options.cache = _.defaults(options.cache, { // assigns these to options.cache
    ids: {},
    registry: {},
    files: [],
    pack: []
  });

  // speed up full rebuilds for developers
  if (!options.minify) {
    browserifyCache(bundler, { cacheFile: browserifyCachePath });
    // note: this file is NOT written in production environments
  }

  bundler.require(entries)
    // transpile to es5
    .transform(babelify.configure(babelConfig))
    // assign each module a module ID, defaulting to old module IDs in cache
    .plugin(labeler, { cachedIds: options.cache.ids })
    // keep only entry (changed) files and new files; do not process existing, unchanged files
    .plugin(filterUnchanged, { cachedFiles: options.cache.files })
    // extract registry - object that maps module IDs to an array of its dependencies' IDs
    .plugin(browserifyExtractRegistry, {
      callback(err, data) {
        if (err) {
          return console.error(err);
        }
        subcache.registry = data;
      }
    })
    // extract ids - object that maps source file paths to module IDs
    // note: used for incremental building
    .plugin(browserifyExtractIds, {
      callback(err, ids) {
        if (err) {
          return console.error(err);
        }
        subcache.ids = ids;
        subcache.files = _.keys(ids);
      }
    })
    // write out browser-pack chunks so module chunks can be concatenated arbitrarily
    .plugin(browserifyGlobalPack, {
      getOutfile: getOutfile('_client-deps'),
      cache: options.cache.path
    });

  if (options.minify) {
    bundler.transform({ global: true, output: { inline_script: true }}, 'uglifyify')
      .plugin(bundleCollapser); // shorten bundle size by rewriting require() to use module IDs
  }

  return new Promise((resolve, reject) => {
    bundler.bundle()
      .on('end', () => {
        // merge the subcache into the cache; overwrite, but never delete
        _.assign(options.cache.registry, subcache.registry);
        _.assign(options.cache.ids, subcache.ids);
        options.cache.files = _.union(subcache.files, options.cache.files);
        // // export registry and IDs
        fs.outputJsonSync(registryPath, options.cache.registry);
        fs.outputJsonSync(idsPath, options.cache.ids);
        resolve(_.map(options.cache.files, (file) => ({ type: 'success', message: file })));
      })
      .on('error', reject)
      .resume(); // force bundle read-stream to flow
  });
}

/**
 * copy kiln js (if it exists) to the public/ folder,
 * compile, dedupe, and bundle dependencies for client.js files,
 * compile, dedupe, and bundle dependencies for model.js and kiln plugin files,
 * compile and bundle passthrough legacy js files (to public/js/_global.js)
 * and add client.js initialization script
 * @param {object} [options]
 * @param {boolean} [options.watch] watch mode
 * @return {Object} with build (Highland Stream) and watch (Chokidar instance)
 */
function compile(options = {}) {
  const watch = options.watch || false,
    minify = options.minify || variables.minify || false,
    globs = options.globs || [],
    clientEntries = _.flatten(_.map(clientGlobs, (client) => glob.sync(client.path))),
    // options are set beforehand, so we can grab the cached files to watch afterwards
    viewModeOptions = { minify };
    // viewModePromise = buildViewModeScripts(clientEntries, viewModeOptions);

  // make sure public/js exists
  fs.ensureDirSync(destPath);


  return {
    build: h(buildViewModeScripts(clientEntries, viewModeOptions)).flatten()
  };

  if (watch) {
    const viewModeWatcher = chokidar.watch(clientEntries);

    return {
      build: h([h(viewModePromise.then((results) => {
        // add the actual IDs (including dependencies) to the watcher
        viewModeWatcher.add(viewModeOptions.cache.ids);
        return results;
      })), buildKiln()]).flatten(),
      watch: viewModeWatcher
    };
  } else {
    return {
      build: buildViewModeScripts(clientEntries, viewModeOptions),
      watch: null
    };
  }

  // console.log('\n\n\nkiln js:', glob.sync(kilnGlob));
  // console.log('\n\n\nkiln plugins:', glob.sync(kilnPluginsGlob));
  // console.log('\n\n\nmodels:', _.flatten(_.map(modelGlobs, (model) => glob.sync(model.path))));
  // console.log('\n\n\nclients:', _.flatten(_.map(clientGlobs, (client) => glob.sync(client.path))));
}

module.exports = compile;

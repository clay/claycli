'use strict';
const _ = require('lodash'),
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
  transformTools = require('browserify-transform-tools'),
  unreachableCodeTransform = require('unreachable-branch-transform'),
  aliasify = require('aliasify'),
  helpers = require('../../compilation-helpers'),
  // globbing patterns
  kilnGlob = './node_modules/clay-kiln/dist/clay-kiln-@(edit|view).js',
  kilnPluginsGlob = 'services/kiln/*!(.test).js',
  // note: in this version we're only supporting bundling of components in your clay repo,
  // NOT components installed via npm. this is due to some issues mapping dependencies that
  // will be sorted out in a later version
  modelGlob = path.resolve(process.cwd(), 'components', '**', 'model.js'),
  clientGlob = path.resolve(process.cwd(), 'components', '**', 'client.js'),
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
 * Re-writes requires to `services/server` to `services/client`
 *
 * @return {function}
 */
function rewriteServiceRequire() {
  return transformTools.makeRequireTransform('requireTransform',
    {evaluateArguments: true},
    ([filepath], {file}, cb) => {
      var parsedRequire = path.parse(filepath), // Parse the require path
        parsedRequiredBy = path.parse(file), // Parse the file path
        absoluteRequirePath = path.resolve(parsedRequiredBy.dir, parsedRequire.dir),
        isServerSideService = _.endsWith(absoluteRequirePath, '/services/server'),// Does it lead to the server-side directory?
        absoluteClientPath = path.resolve(absoluteRequirePath, '../../services/client', parsedRequire.name);

      // Let's test if the client-side version of the service exists. If it doesn't then this task
      // is going to haaaaaaaaaaaang so that it won't compile because streams
      if (isServerSideService && !fs.existsSync(`${absoluteClientPath}.js`)) {
        throw new Error('A server-side only service must have a client-side counterpart');
      }

      // If it's pointed to the server-side only directory then we're going to map it to the client-side
      // version of the service. This enforces that we _MUST_ have that service available.
      return isServerSideService ? cb(null, `require('${absoluteClientPath}')`) : cb();
    });
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
 * @param  {object} dep
 * @return {string[]|string}
 */
function getOutfile(dep) {
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

    // deps get put into <number>.js and _deps-<letter>-<letter>.js
    return [
      path.join(destPath, `${id}.js`),
      path.join(destPath, `_deps-${helpers.bucket(name)}.js`)
    ];
  } else {
    // client.js files are compiled to <name>.client.js
    return path.join(destPath, `${id}.js`);
  }
}

/**
 * browserify plugin to replace process.env with window.process.env
 * and extract all env var nams used
 * @param {object} b Browserify instance
 * @param {object} [opts] plugin options
 * @param {function} [opts.callback]
 */
function transformEnv(b, { callback }) {
  const env = [];

  b.pipeline.get('deps').push(through2.obj(function (item, enc, cb) {
    const matches = item.source.match(/process\.env\.(\w+)/ig);

    if (matches) {
      item.source = item.source.replace(/process\.env/ig, 'window.process.env'); // reference window, so browserify doesn't bundle in `process`
      // regex global flag doesn't give us back the actual key, so we need to grab it from the match
      matches.forEach(function (match) {
        env.push(match.match(/process\.env\.(\w+)/i)[1]);
      });
    }
    cb(null, item);
  }).on('end', () => {
    if (callback) callback(null, env);
  }));
}

/**
 * compile, dedupe, and bundle model.js and their deps
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
function buildScripts(entries, options = {}) {
  const bundler = browserify({
      // insertGlobals: true,
      dedupe: false,
      // cache and packageCache are used by browserify-cache-api to speed up full rebuilds
      cache: {},
      packageCache: {}
    }),
    subcache = {
      ids: {},
      env: [],
      registry: {},
      files: []
    };

  options.cache = _.defaults(options.cache, { // assigns these to options.cache
    ids: {},
    env: [],
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
    // remove unreachable code branches
    .transform(unreachableCodeTransform)
    // transform any requires for jsdom to false, as some server-side libraries include it
    // by default, when they could simply use 'window'
    .transform(aliasify, {
      aliases: {
        jsdom: false
      }
    })
    // map services/server to services/client
    .transform(rewriteServiceRequire())
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
    // transform process.env into window.process.env and export array of env vars
    .plugin(transformEnv, {
      callback: (err, env) => {
        if (err) {
          return console.error(err);
        };
        subcache.env = env;
      }
    })
    // write out browser-pack chunks so module chunks can be concatenated arbitrarily
    .plugin(browserifyGlobalPack, {
      getOutfile,
      cache: options.cache.path
    })
    // shorten bundle size by rewriting require() to use module IDs
    .plugin(bundleCollapser);

  if (options.minify) {
    bundler.transform({ global: true, output: { inline_script: true }}, 'uglifyify');
  }

  return new Promise((resolve, reject) => {
    bundler.bundle()
      .on('end', () => {
        // merge the subcache into the cache; overwrite, but never delete
        _.assign(options.cache.registry, subcache.registry);
        _.assign(options.cache.ids, subcache.ids);
        options.cache.files = _.union(subcache.files, options.cache.files);
        options.cache.env = _.union(subcache.env, options.cache.env);
        // // export registry, env, and IDs
        fs.outputJsonSync(registryPath, options.cache.registry);
        fs.outputJsonSync(clientEnvPath, options.cache.env);
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
    bundleEntries = glob.sync(clientGlob).concat(glob.sync(modelGlob)),
    // options are set beforehand, so we can grab the cached files to watch afterwards
    bundleOptions = { minify },
    watcher = watch && chokidar.watch(bundleEntries);
    // builder = h([
    //   // buildKiln(),
    //   // buildViewModeScripts(clientEntries, bundleOptions),
    //   // h(buildScripts(modelEntries, bundleOptions)).flatten()
    // ]).flatten();

  // make sure public/js exists
  fs.ensureDirSync(destPath);

  return {
    build: h(buildScripts(bundleEntries, bundleOptions).then((res) => {
      if (watcher) {
        watcher.add(bundleOptions.cache.files);
        watcher.on('change', (file) => buildScripts([file], bundleOptions));
      }
      return res;
    })).flatten().append(buildKiln()),
    watch: watcher
  };
}

module.exports = compile;

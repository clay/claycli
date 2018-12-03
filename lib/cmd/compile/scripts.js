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
  replace = require('gulp-replace'),
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
  vueify = require('@nymag/vueify'),
  uglifyify = require('uglifyify'),
  extractCSS = require('@nymag/vueify/plugins/extract-css'),
  autoprefixer = require('autoprefixer'),
  cssImport = require('postcss-import'),
  mixins = require('postcss-mixins'),
  nested = require('postcss-nested'),
  simpleVars  = require('postcss-simple-vars'),
  reporters = require('../../reporters'),
  helpers = require('../../compilation-helpers'),
  // globbing patterns
  kilnGlob = './node_modules/clay-kiln/dist/clay-kiln-@(edit|view).js',
  kilnPluginsGlob = path.resolve(process.cwd(), 'services', 'kiln', 'index.js'),
  // note: in this version we're only supporting bundling of components/layouts in your clay repo,
  // NOT components installed via npm. this is due to some issues mapping dependencies
  // (as well as issues with group-concat) that will be sorted out in a later version
  componentModelsGlob = path.resolve(process.cwd(), 'components', '**', 'model.js'),
  componentClientsGlob = path.resolve(process.cwd(), 'components', '**', 'client.js'),
  layoutModelsGlob = path.resolve(process.cwd(), 'layouts', '**', 'model.js'),
  layoutClientsGlob = path.resolve(process.cwd(), 'layouts', '**', 'client.js'),
  // destination paths
  destPath = path.resolve(process.cwd(), 'public', 'js'),
  registryPath = path.resolve(destPath, '_registry.json'),
  idsPath = path.resolve(destPath, '_ids.json'),
  clientEnvPath = path.resolve(process.cwd(), 'client-env.json'), // make sure this is .gitignored!
  browserifyCachePath = path.resolve(process.cwd(), 'browserify-cache.json'), // make sure this is gitignored!
  kilnPluginCSSDestPath = path.resolve(process.cwd(), 'public', 'css', '_kiln-plugins.css'), // different from the script destinations
  variables = {
    // these arguments allow setting default env variables
    minify:  process.env.CLAYCLI_COMPILE_MINIFIED || process.env.CLAYCLI_COMPILE_MINIFIED_SCRIPTS || ''
  },
  babelConfig = {
    // force babel to resolve the preset from claycli's node modules rather than the clay install's repo
    presets: [
      [
        require('@babel/preset-env'),
        {
          targets: Object.assign(helpers.getConfigFileOrBrowsersList('babelTargets'), {})
        }
      ]
    ]
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
 * copy the _client-init.js script to public/js
 * this initializes all of the client.js component controllers,
 * as long as they export an initialization function
 * @return {Stream}
 */
function copyClientInit() {
  return h(gulp.src(path.join(__dirname, '_client-init.js'))
    .pipe(changed(destPath, { hasChanged: helpers.hasChanged }))
    .pipe(replace('#NODE_ENV#', process.env.NODE_ENV || ''))
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
 * @param {array} legacyFiles
 * @return {string|undefined} module id
 */
function getModuleId(file, legacyFiles) {
  const name = file.split('/').slice(-2)[0],
    // everything in services/kiln is considered a kiln plugin,
    // and compiles to public/js/_kiln-plugins.js
    isKilnPlugin = _.includes(file, path.join(process.cwd(), 'services', 'kiln')),
    // everything passed in via legacy globs compiles to public/js/_global.js
    isLegacyFile = _.includes(legacyFiles, file);

  if (isKilnPlugin) {
    const parsedPath = path.parse(file);

    // return the folder AND filename
    return `${_.last(parsedPath.dir.split(path.sep))}_${parsedPath.name}.kilnplugin`; // e.g. plugins_kiln-tracking.kilnplugin
  } else if (isLegacyFile) {
    return `${path.parse(file).name}.legacy`;
  } else if (_.includes(file, path.join(process.cwd(), 'components')) && _.endsWith(file, 'client.js')) {
    return `${name}.client`;
  } else if (_.includes(file, path.join(process.cwd(), 'components')) && _.endsWith(file, 'model.js')) {
    return `${name}.model`;
  } // else it uses an incremented number
}

/**
* returns a function that retrieves a module ID for a specified file.
* defers to IDs in cachedIds if set.
* @param {Object} [opts]
* @param {Object} [opts.cachedIds] Map of file paths to previously generated IDs
* @param {array}  [opts.legacyFiles]
* @return {function} A function that returns an ID given a specified file
**/
function idGenerator({ cachedIds, legacyFiles }) {
  const generatedIds = _.assign({}, cachedIds);
  // set to the highest number in the generateIds, or 1
  let i = _.max(_.values(generatedIds).filter(_.isFinite)) + 1 || 1;

  return (file) => {
    let id = generatedIds[file] || (generatedIds[file] = getModuleId(file, legacyFiles) || i++);

    temporaryIDs[id] = file;
    return id;
  };
}

/**
 * browserify plugin to assign module IDs to each module, replacing browserify's
 * built-in labeler. ensures existing modules are assigned their current IDs.
 * @param {object} b
 * @param {object} [opts]
 * @param {object} [opts.cachedIds] mapping of current filenames to module IDs
 * @param {array} [opts.legacyFiles]
 * @returns {object} browserify plugin
 */
function labeler(b, { cachedIds = {}, legacyFiles }) {
  const getOrGenerateId = idGenerator({ cachedIds, legacyFiles });

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
  } else if (_.endsWith(id, '.kilnplugin')) {
    // all kiln plugins get compiled to public/js/_kiln-plugins.js
    return path.join(destPath, '_kiln-plugins.js');
  } else if (_.endsWith(id, '.legacy')) {
    // legacy js is compiled to public/js/_global.js and public/js/<name>.legacy.js
    // and should be included on every page (in view mode)
    return [
      path.join(destPath, '_global.js'),
      path.join(destPath, `${id}.js`)
    ];
  } else if (_.endsWith(id, '.model')) {
    // model.js files are compiled to <name>.model.js and _models-<letter>-<letter>.js
    return [
      path.join(destPath, `${id}.js`),
      path.join(destPath, `_models-${helpers.bucket(id)}.js`)
    ];
  } else if (_.isFinite(parseInt(id))) {
    const name = _.isString(temporaryIDs[id]) && path.parse(temporaryIDs[id]).name;

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
 * @param {array} [options.legacyFiles]
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
    // transpile .vue files (kiln plugins)
    .transform(vueify, {
      babel: babelConfig,
      postcss: [
        cssImport(),
        autoprefixer(helpers.getConfigFileOrBrowsersList('autoprefixerOptions')),
        mixins(),
        nested(),
        simpleVars()
      ]
    })
    // and extract the .vue css to a single file
    .plugin(extractCSS, { out: kilnPluginCSSDestPath })
    // remove unreachable code branches
    .transform(unreachableCodeTransform)
    // map services/server to services/client
    .transform(rewriteServiceRequire())
    // assign each module a module ID, defaulting to old module IDs in cache
    .plugin(labeler, { cachedIds: options.cache.ids, legacyFiles: options.legacyFiles })
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
    bundler.transform(uglifyify, { global: true, output: { inline_script: true }});
  }

  return new Promise((resolve) => {
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
        resolve(_.map(entries, (file) => ({ type: 'success', message: file })));
      })
      .on('error', (e) => resolve([{ type: 'error', message: e.message }]))
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
 * @param {boolean} [options.minify]
 * @param {array} [option.globs]
 * @return {Object} with build (Highland Stream) and watch (Chokidar instance)
 */
function compile(options = {}) {
  const watch = options.watch || false,
    minify = options.minify || variables.minify || false,
    globs = options.globs || [],
    reporter = options.reporter || 'pretty',
    globFiles = globs.length ? _.flatten(_.map(globs, (g) => glob.sync(path.join(process.cwd(), g)))) : [],
    // client.js, model.js, kiln plugins, and legacy global scripts are passed to megabundler
    bundleEntries = glob.sync(componentClientsGlob).concat(
      glob.sync(componentModelsGlob),
      glob.sync(layoutClientsGlob),
      glob.sync(layoutModelsGlob),
      glob.sync(kilnPluginsGlob),
      globFiles
    ),
    // options are set beforehand, so we can grab the cached files to watch afterwards
    bundleOptions = { minify, legacyFiles: globFiles },
    // start by watching megabundled entries (client, model, kiln plugins, legacy _global.js) and kiln files
    watcher = watch && chokidar.watch(bundleEntries);

  // make sure public/js exists
  fs.ensureDirSync(destPath);

  return {
    build: h(buildScripts(bundleEntries, bundleOptions).then((res) => {
      if (watcher) {
        // watch all megabundled dependencies
        watcher.add(bundleOptions.cache.files);
        // add kiln glob
        watcher.add(kilnGlob);
        watcher.on('change', (file) => {
          if (_.includes(file, 'node_modules/clay-kiln')) {
            // kick off re-copying of kiln scripts
            buildKiln();
          } else {
            // recompile changed megabundled files
            buildScripts([file], bundleOptions)
              .then(function (result) {
                _.map(result, reporters.logAction(reporter, 'compile'));
              });
            // and re-copy the _client-init.js if it has changed
            copyClientInit();
          }
        });
      }
      return res;
    })).flatten().append(buildKiln()).append(copyClientInit()),
    watch: watcher
  };
}

module.exports = compile;
// you may access getDependencies here, or (recommended) call it directly with
// require('claycli/lib/cmd/compile/get-script-dependencies').getDependencies
module.exports.getDependencies = require('./get-script-dependencies').getDependencies;

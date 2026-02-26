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
  // webpack
  webpack = require('webpack'),
  terser = require('terser'),
  babel = require('gulp-babel'),
  { VueLoaderPlugin } = require('vue-loader'),
  MiniCssExtractPlugin = require('mini-css-extract-plugin'),
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
  componentModelsGlob = path.resolve(process.cwd(), 'components', '**', 'model.js'),
  componentKilnGlob = path.resolve(process.cwd(), 'components', '**', 'kiln.js'),
  componentClientsGlob = path.resolve(process.cwd(), 'components', '**', 'client.js'),
  layoutModelsGlob = path.resolve(process.cwd(), 'layouts', '**', 'model.js'),
  layoutClientsGlob = path.resolve(process.cwd(), 'layouts', '**', 'client.js'),
  // destination paths
  destPath = path.resolve(process.cwd(), 'public', 'js'),
  registryPath = path.resolve(destPath, '_registry.json'),
  idsPath = path.resolve(destPath, '_ids.json'),
  clientEnvPath = path.resolve(process.cwd(), 'client-env.json'),
  kilnPluginCSSDestPath = path.resolve(process.cwd(), 'public', 'css', '_kiln-plugins.css'),
  variables = {
    minify:  process.env.CLAYCLI_COMPILE_MINIFIED || process.env.CLAYCLI_COMPILE_MINIFIED_SCRIPTS || ''
  },
  babelConfig = {
    presets: [
      [
        require('@babel/preset-env'),
        {
          targets: Object.assign(helpers.getConfigFileOrBrowsersList('babelTargets'), {}),
          ...helpers.getConfigFileValue('babelPresetEnvOptions'),
        }
      ]
    ]
  },
  temporaryIDs = {};

/**
 * copy kiln js if it has changed
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
 * @return {Stream}
 */
function copyClientInit() {
  return h(gulp.src(path.join(__dirname, '_client-init.js'))
    .pipe(changed(destPath, { hasChanged: helpers.hasChanged }))
    .pipe(babel(babelConfig))
    .pipe(replace('#NODE_ENV#', process.env.NODE_ENV || ''))
    .pipe(gulp.dest(destPath))
    .pipe(es.mapSync((file) => ({ type: 'success', message: file.path }))));
}

/**
 * Re-writes requires to `services/server` to `services/client`
 * Used as a Webpack NormalModuleReplacementPlugin callback.
 * @param {object} resource webpack resource object
 */
function rewriteServiceRequire(resource) {
  var requestPath = resource.request,
    contextPath = resource.context || '',
    absoluteRequirePath = path.resolve(contextPath, requestPath),
    serverSegment = path.join('services', 'server') + path.sep,
    isServerSideService = absoluteRequirePath.includes(serverSegment) ||
      absoluteRequirePath.endsWith(path.join('services', 'server')),
    clientPath;

  if (isServerSideService) {
    clientPath = absoluteRequirePath.replace(
      new RegExp(_.escapeRegExp(path.join('services', 'server'))),
      path.join('services', 'client')
    );
    if (!fs.existsSync(`${clientPath}.js`) && !fs.existsSync(clientPath)) {
      throw new Error('A server-side only service must have a client-side counterpart');
    }
    resource.request = resource.request.replace(/services\/server/, 'services/client');
  }
}

/**
 * for a given file, return its module IDs
 * @param {string} file absolute file path
 * @param {array} legacyFiles
 * @return {string|undefined} module id
 */
function getModuleId(file, legacyFiles) {
  const name = file.split('/').slice(-2)[0],
    isKilnPlugin = _.includes(file, path.join(process.cwd(), 'services', 'kiln')),
    isLegacyFile = _.includes(legacyFiles, file),
    fileTypes = ['client', 'kiln', 'model'];

  if (isKilnPlugin) {
    const parsedPath = path.parse(file);

    return `${_.last(parsedPath.dir.split(path.sep))}_${parsedPath.name}.kilnplugin`;
  } else if (isLegacyFile) {
    return `${path.parse(file).name}.legacy`;
  } else if (_.includes(file, path.join(process.cwd(), 'components'))) {
    for (let x = 0; x < fileTypes.length; x++) {
      if (_.endsWith(file, `${fileTypes[x]}.js`)) {
        return `${name}.${fileTypes[x]}`;
      }
    }
  }
}


/**
 * returns a function that retrieves a module ID for a specified file.
 * @param {Object} [opts]
 * @param {Object} [opts.cachedIds] Map of file paths to previously generated IDs
 * @param {array}  [opts.legacyFiles]
 * @return {function}
 */
function idGenerator({ cachedIds, legacyFiles }) {
  const generatedIds = _.assign({}, cachedIds);

  let i = _.max(_.values(generatedIds).filter(_.isFinite)) + 1 || 1;

  return (file) => {
    let id = generatedIds[file] || (generatedIds[file] = getModuleId(file, legacyFiles) || i++);

    temporaryIDs[id] = file;
    return id;
  };
}

/**
 * for a given dependency, return the path(s) of the output file(s)
 * @param  {object} dep
 * @return {string[]|string}
 */
function getOutfile(dep) {
  const id = dep.id;

  if (_.includes(['prelude', 'postlude'], id)) {
    return path.join(destPath, `_${id}.js`);
  } else if (_.endsWith(id, '.kilnplugin')) {
    return path.join(destPath, '_kiln-plugins.js');
  } else if (_.endsWith(id, '.legacy')) {
    return [
      path.join(destPath, '_global.js'),
      path.join(destPath, `${id}.js`)
    ];
  } else if (_.endsWith(id, '.model')) {
    return [
      path.join(destPath, `${id}.js`),
      path.join(destPath, `_models-${helpers.bucket(id)}.js`)
    ];
  } else if (_.endsWith(id, '.kiln')) {
    return [
      path.join(destPath, `${id}.js`),
      path.join(destPath, `_kiln-${helpers.bucket(id)}.js`)
    ];
  } else if (_.isFinite(parseInt(id))) {
    const name = _.isString(temporaryIDs[id]) && path.parse(temporaryIDs[id]).name;

    return [
      path.join(destPath, `${id}.js`),
      path.join(destPath, `_deps-${helpers.bucket(name)}.js`)
    ];
  } else {
    return path.join(destPath, `${id}.js`);
  }
}

/**
 * get the prelude content (sets up window.modules)
 * @return {string}
 */
function getPrelude() {
  return 'window.modules=[];';
}

/**
 * get the postlude content (sets up require function)
 * @return {string}
 */
function getPostlude() {
  // The postlude is a minified require() shim that resolves modules from window.modules
  return 'require=(function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o])' +
    '{var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);' +
    'var f=new Error("Cannot find module \'"+o+"\'");throw f.code="MODULE_NOT_FOUND",f}' +
    'var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];' +
    'return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}' +
    'var i=typeof require=="function"&&require;' +
    'for(var o=0;o<r.length;o++)s(r[o]);return s})(window.modules,{},[]);';
}

/**
 * format a module in the global-pack format
 * @param {string} id module ID
 * @param {string} source transpiled source code
 * @param {object} deps mapping of require strings to resolved module IDs
 * @return {string}
 */
function formatModule(id, source, deps) {
  return `window.modules["${id}"] = [function(require,module,exports){${source}}, ${JSON.stringify(deps)}];`;
}

/**
 * Create a Webpack configuration for the megabundler
 * @param {string[]} entries array of absolute file paths
 * @param {object} options
 * @param {boolean} options.minify
 * @param {string[]} options.legacyFiles
 * @return {object} webpack config
 */
function createWebpackConfig(entries, options) {
  var entry = {};

  entries.forEach((file, i) => {
    entry[i] = file;
  });

  return {
    mode: options.minify ? 'production' : 'development',
    devtool: false,
    context: process.cwd(),
    entry: entry,
    output: {
      path: destPath,
      filename: '[name].js'
    },
    resolve: {
      extensions: ['.js', '.vue', '.json'],
      fallback: {
        assert: false,
        buffer: false,
        child_process: false,
        cluster: false,
        crypto: false,
        dgram: false,
        dns: false,
        domain: false,
        events: false,
        fs: false,
        hiredis: false,
        http: false,
        https: false,
        net: false,
        os: false,
        path: false,
        querystring: false,
        readline: false,
        stream: false,
        string_decoder: false,
        timers: false,
        tls: false,
        tty: false,
        url: false,
        util: false,
        v8: false,
        vm: false,
        zlib: false
      }
    },
    resolveLoader: {
      modules: [path.resolve(__dirname, '..', '..', '..', 'node_modules'), 'node_modules']
    },
    module: {
      rules: [
        {
          test: /\.vue$/,
          loader: 'vue-loader'
        },
        {
          test: /\.js$/,
          exclude: /node_modules/,
          use: {
            loader: 'babel-loader',
            options: {
              presets: [
                [
                  require.resolve('@babel/preset-env'),
                  {
                    targets: Object.assign(helpers.getConfigFileOrBrowsersList('babelTargets'), {}),
                    ...helpers.getConfigFileValue('babelPresetEnvOptions'),
                  }
                ]
              ],
              plugins: [require.resolve('babel-plugin-lodash')]
            }
          }
        },
        {
          test: /\.(svg|png|gif|jpe?g|webp|ico)$/i,
          type: 'asset/resource'
        },
        {
          test: /\.css$/,
          use: [
            MiniCssExtractPlugin.loader,
            'css-loader',
            {
              loader: 'postcss-loader',
              options: {
                postcssOptions: {
                  plugins: [
                    cssImport(),
                    autoprefixer(helpers.getConfigFileOrBrowsersList('autoprefixerOptions')),
                    mixins(),
                    nested(),
                    simpleVars()
                  ]
                }
              }
            }
          ]
        }
      ]
    },
    plugins: [
      new VueLoaderPlugin(),
      new MiniCssExtractPlugin({
        filename: '_css-extract-[contenthash:8].css'
      }),
      new webpack.NormalModuleReplacementPlugin(
        /services\/server/,
        rewriteServiceRequire
      )
    ],
    optimization: {
      minimize: Boolean(options.minify)
    },
    cache: options.minify ? false : {
      type: 'filesystem',
      cacheDirectory: path.resolve(process.cwd(), '.webpack-cache')
    },
    infrastructureLogging: { level: 'error' }
  };
}

/**
 * resolve the file path from a webpack module identifier
 * strips loader prefixes and returns null for non-file modules
 * @param {object} mod webpack stats module
 * @return {string|null}
 */
function resolveModulePath(mod) {
  var filePath = mod.identifier;

  if (!filePath || filePath.startsWith('webpack/') || mod.moduleType === 'runtime') {
    return null;
  }

  if (filePath.includes('!')) {
    filePath = filePath.split('!').pop();
  }

  return path.isAbsolute(filePath) ? filePath : null;
}

/**
 * build dependency graph from webpack stats modules
 * @param {Array} modules webpack stats modules array
 * @param {function} getOrGenerateId ID generator function
 * @return {object} { depsMap: {moduleId: {req: depId}}, registryMap: {moduleId: [depIds]} }
 */
function buildDependencyGraph(modules, getOrGenerateId) {
  var identifierToPath = {},
    pathToModuleId = {},
    depsMap = {},
    registryMap = {};

  // Pass 1: assign IDs and build lookup maps
  modules.forEach((mod) => {
    var filePath = resolveModulePath(mod),
      moduleId;

    if (filePath) {
      moduleId = getOrGenerateId(filePath);
      identifierToPath[mod.identifier] = filePath;
      pathToModuleId[filePath] = moduleId;
      depsMap[moduleId] = {};
      registryMap[moduleId] = [];
    }
  });

  // Pass 2: build deps from reasons
  modules.forEach((mod) => {
    var filePath = resolveModulePath(mod),
      moduleId;

    if (!filePath) {
      return;
    }
    moduleId = pathToModuleId[filePath];
    if (!moduleId) {
      return;
    }
    (mod.reasons || []).forEach((reason) => {
      var parentPath, parentId;

      if (!reason.moduleIdentifier || !reason.userRequest) {
        return;
      }
      parentPath = identifierToPath[reason.moduleIdentifier];
      if (!parentPath) {
        return;
      }
      parentId = pathToModuleId[parentPath];
      if (!parentId) {
        return;
      }
      depsMap[parentId][reason.userRequest] = moduleId;
      if (!_.includes(registryMap[parentId], moduleId)) {
        registryMap[parentId].push(moduleId);
      }
    });
  });

  return { depsMap: depsMap, registryMap: registryMap };
}

/**
 * extract environment variable references from module source
 * @param {string} source module source code
 * @param {Array} envVars accumulator for extracted variable names
 * @return {string} source with process.env replaced by window.process.env
 */
function extractEnvVars(source, envVars) {
  var envMatches = source.match(/process\.env\.(\w+)/ig);

  if (envMatches) {
    source = source.replace(/process\.env/ig, 'window.process.env');
    envMatches.forEach((match) => {
      var envVar = match.match(/process\.env\.(\w+)/i);

      if (envVar) {
        envVars.push(envVar[1]);
      }
    });
  }
  return source;
}

/**
 * process a single webpack module: assign ID, extract env vars, write output
 * @param {object} mod webpack stats module
 * @param {function} getOrGenerateId ID generator function
 * @param {object} ctx context with subcache, fileContents, envVars, depsMap, registryMap
 */
function processModule(mod, getOrGenerateId, ctx) {
  var filePath = resolveModulePath(mod),
    source, moduleId, deps, content, outfiles;

  if (!filePath) {
    return;
  }

  source = mod.source || '';
  moduleId = getOrGenerateId(filePath);
  deps = ctx.depsMap[moduleId] || {};
  source = extractEnvVars(source, ctx.envVars);

  // Track in subcache
  ctx.subcache.ids[filePath] = moduleId;
  ctx.subcache.files.push(filePath);
  ctx.subcache.registry[moduleId] = ctx.registryMap[moduleId] || [];

  // Format module in global-pack format and write to output files
  content = formatModule(moduleId, source, deps);
  outfiles = getOutfile({ id: moduleId });

  if (!Array.isArray(outfiles)) {
    outfiles = [outfiles];
  }
  outfiles.forEach((outfile) => {
    ctx.fileContents[outfile] = (ctx.fileContents[outfile] || '') + content + '\n';
  });
}

/**
 * check if a build error relates to an asset/resource file (non-fatal)
 * @param {object} error error result object with message
 * @return {boolean}
 */
function isAssetError(error) {
  var msg = error.message || '';

  return /\.(svg|png|gif|jpe?g|webp|ico|woff2?|ttf|eot|mp[34]|webm|ogg|wav)/i.test(msg);
}

/**
 * build final result array: errors only when JS compile errors occurred,
 * errors + success entries when only asset/resource errors (or no errors)
 * @param {Array} errors collected error results
 * @param {string[]} entries original entry file paths
 * @return {Array} combined result array
 */
function collectResults(errors, entries) {
  if (errors.length === 0 || errors.every(isAssetError)) {
    return errors.concat(_.map(entries, (file) => ({ type: 'success', message: file })));
  }
  return errors;
}

/**
 * minify collected file contents using terser (compress only, no mangling
 * to preserve function(require,module,exports) wrapper parameter names)
 * @param {object} fileContents mapping of output file paths to source strings
 * @return {Promise}
 */
async function minifyFileContents(fileContents) {
  var paths = Object.keys(fileContents),
    i, minified;

  for (i = 0; i < paths.length; i++) {
    minified = await terser.minify(fileContents[paths[i]], {
      compress: true,
      mangle: false
    });
    if (minified.code !== undefined) {
      fileContents[paths[i]] = minified.code;
    }
  }
}

/**
 * compile, dedupe, and bundle model.js and their deps
 * compile, dedupe, and bundle client.js and their deps
 * Uses Webpack for dependency resolution and transpilation,
 * then writes output in global-pack format for backward compatibility.
 * @param {string|string[]} [entries]
 * @param {object} [options]
 * @param {boolean} [options.minify]
 * @param {array} [options.legacyFiles]
 * @param {object} [options.cache]
 * @return {Promise}
 */
function buildScripts(entries, options = {}) {
  var getOrGenerateId, config,
    subcache = {
      ids: {},
      env: [],
      registry: {},
      files: []
    };

  options.cache = _.defaults(options.cache, {
    ids: {},
    env: [],
    registry: {},
    files: [],
    pack: []
  });

  getOrGenerateId = idGenerator({ cachedIds: options.cache.ids, legacyFiles: options.legacyFiles });
  config = createWebpackConfig(entries, options);

  return new Promise((resolve) => {
    webpack(config, async (err, stats) => {
      var info, ctx, graph, cssChunks, cssContent;

      if (err) {
        return resolve([{ type: 'error', message: err.message }]);
      }

      info = stats.toJson({ modules: true, source: true, reasons: true });
      ctx = { subcache: subcache, fileContents: {}, envVars: [], errors: [] };

      // Collect errors but continue processing — individual module failures
      // should not prevent the rest of the build from completing
      if (info.errors && info.errors.length > 0) {
        info.errors.forEach((e) => {
          ctx.errors.push({ type: 'error', message: e.message || e });
        });
      }

      // Two-pass module processing:
      // Pass 1 — build identity maps and dependency graph from reasons
      // Pass 2 — process modules with populated deps
      if (info.modules) {
        graph = buildDependencyGraph(info.modules, getOrGenerateId);
        ctx.depsMap = graph.depsMap;
        ctx.registryMap = graph.registryMap;
        info.modules.forEach((mod) => {
          processModule(mod, getOrGenerateId, ctx);
        });
      }

      // Write prelude and postlude
      ctx.fileContents[path.join(destPath, '_prelude.js')] = getPrelude();
      ctx.fileContents[path.join(destPath, '_postlude.js')] = getPostlude();

      // Minify emitted global-pack content when --minify is active
      if (options.minify) {
        await minifyFileContents(ctx.fileContents);
      }

      // Write all output files
      fs.ensureDirSync(destPath);
      Object.keys(ctx.fileContents).forEach((outfile) => {
        fs.ensureDirSync(path.dirname(outfile));
        fs.writeFileSync(outfile, ctx.fileContents[outfile]);
      });

      // Merge extracted CSS chunks into single kiln-plugins CSS file
      cssChunks = glob.sync(path.join(destPath, '_css-extract-*.css'));

      if (cssChunks.length > 0) {
        cssContent = cssChunks.map((f) => fs.readFileSync(f, 'utf8')).join('\n');

        fs.ensureDirSync(path.dirname(kilnPluginCSSDestPath));
        fs.writeFileSync(kilnPluginCSSDestPath, cssContent);
        cssChunks.forEach((f) => fs.removeSync(f));
      }

      // Merge subcache into main cache
      _.assign(options.cache.registry, subcache.registry);
      _.assign(options.cache.ids, subcache.ids);
      options.cache.files = _.union(subcache.files, options.cache.files);
      options.cache.env = _.union(ctx.envVars, options.cache.env);

      // Export registry, env, and IDs
      fs.outputJsonSync(registryPath, options.cache.registry);
      fs.outputJsonSync(clientEnvPath, options.cache.env);
      fs.outputJsonSync(idsPath, options.cache.ids);

      resolve(collectResults(ctx.errors, entries));
    });
  });
}

/**
 * compile scripts using Webpack
 * @param {object} [options]
 * @param {boolean} [options.watch]
 * @param {boolean} [options.minify]
 * @param {array} [options.globs]
 * @return {Object} with build (Highland Stream) and watch (Chokidar instance)
 */
function compile(options = {}) { // eslint-disable-line complexity
  const watch = options.watch || false,
    minify = options.minify || variables.minify || false,
    globs = options.globs || [],
    reporter = options.reporter || 'pretty',
    globFiles = globs.length ? _.flatten(_.map(globs, (g) => glob.sync(path.join(process.cwd(), g)))) : [],
    bundleEntries = glob.sync(componentClientsGlob).concat(
      glob.sync(componentModelsGlob),
      glob.sync(componentKilnGlob),
      glob.sync(layoutClientsGlob),
      glob.sync(layoutModelsGlob),
      glob.sync(kilnPluginsGlob),
      globFiles
    ),
    bundleOptions = { minify, legacyFiles: globFiles },
    watcher = watch && chokidar.watch(bundleEntries);

  fs.ensureDirSync(destPath);

  return {
    build: h(buildScripts(bundleEntries, bundleOptions).then((res) => {
      if (watcher) {
        watcher.add(bundleOptions.cache.files);
        watcher.add(kilnGlob);
        watcher.on('change', (file) => {
          if (_.includes(file, 'node_modules/clay-kiln')) {
            buildKiln();
          } else {
            buildScripts(bundleOptions.cache.files, bundleOptions)
              .then(function (result) {
                _.map(result, reporters.logAction(reporter, 'compile'));
              });
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
module.exports.getDependencies = require('./get-script-dependencies').getDependencies;

// for testing
module.exports.getModuleId = getModuleId;
module.exports.idGenerator = idGenerator;
module.exports.getOutfile = getOutfile;
module.exports.rewriteServiceRequire = rewriteServiceRequire;
module.exports.buildScripts = buildScripts;
module.exports._temporaryIDs = temporaryIDs;
module.exports._destPath = destPath;

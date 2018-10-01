'use strict';
const _ = require('lodash'),
  fs = require('fs-extra'),
  h = require('highland'),
  path = require('path'),
  es = require('event-stream'),
  gulp = require('gulp'),
  rename = require('gulp-rename'),
  changed = require('gulp-changed'),
  cssmin = require('gulp-cssmin'),
  gulpIf = require('gulp-if'),
  detective = require('detective-postcss'),
  autoprefixer = require('autoprefixer'),
  postcss = require('gulp-postcss'),
  cssImport = require('postcss-import'),
  mixins = require('postcss-mixins'),
  nested = require('postcss-nested'),
  simpleVars  = require('postcss-simple-vars'),
  helpers = require('../../compilation-helpers'),
  componentsSrc = path.join(process.cwd(), 'styleguides', '**', 'components', '*.css'),
  layoutsSrc = path.join(process.cwd(), 'styleguides', '**', 'layouts', '*.css'),
  destPath = path.join(process.cwd(), 'public', 'css'),
  variables = {
    // asset host and path are set in different environments when using separate servers/subdomains for assets
    'asset-host': process.env.CLAYCLI_COMPILE_ASSET_HOST ? process.env.CLAYCLI_COMPILE_ASSET_HOST.replace(/\/$/, '') : '',
    'asset-path': process.env.CLAYCLI_COMPILE_ASSET_PATH || '',
    // these arguments allow setting default env variables
    minify:  process.env.CLAYCLI_COMPILE_MINIFIED || process.env.CLAYCLI_COMPILE_MINIFIED_STYLES || ''
  };

/**
 * determine filepath for compiled css, based on the source filepath
 * used to test if a css file has changed
 * @param  {string} filepath
 * @return {string}
 */
function transformPath(filepath) {
  const component = path.basename(filepath, '.css'), // component name, plus variation if applicable
    pathArray = path.dirname(filepath).split(path.sep),
    styleguide = pathArray[pathArray.length - 2]; // parses 'styleguides/<styleguide>/components' for the name of the styleguide

  return path.join(destPath, `${component}.${styleguide}.css`);
}

/**
 * determine if a file (or its dependencies) has changed
 * note: this only checks ONE level of dependencies, as that covers most
 * current use cases and eliminates the need for complicated dependency-checking logic.
 * If there is a need to check n-number of dependencies, please open a ticket and we can re-evaluate!
 * @param  {Stream}  stream
 * @param  {Vinyl}  sourceFile
 * @param  {string}  targetPath
 * @return {Promise}
 */
function hasChanged(stream, sourceFile, targetPath) {
  let deps;

  try {
    deps = detective(sourceFile.contents.toString());
  } catch (e) {
    // detective handles most postcss syntax, but doesn't know about plugins
    // if it hits something that confuses it, fail gracefully (disregard any potential dependencies)
    deps = [];
  }

  return fs.stat(targetPath).then((targetStat) => {
    const hasUpdatedDeps = _.some(deps, (dep) => {
      const depStat = fs.statSync(path.join(process.cwd(), 'styleguides', dep));

      return depStat && depStat.ctime > targetStat.ctime;
    });

    if (hasUpdatedDeps || sourceFile.stat && sourceFile.stat.ctime > targetStat.ctime) {
      stream.push(sourceFile);
    }
  }).catch(() => {
    // targetPath doesn't exist! gotta compile the source
    stream.push(sourceFile);
  });
}

/**
 * rename css files
 * styleguide/<styleguide>/components/<component>.css
 * becomes public/css/<component>.<styleguide>.css
 * @param  {object} filepath
 */
function renameFile(filepath) {
  const component = filepath.basename,
    styleguide = filepath.dirname.split('/')[0];

  filepath.dirname = '';
  filepath.basename = `${component}.${styleguide}`;
}

/**
 * compile postcss styles to public/css
 * @param {object} [options]
 * @param {boolean} [options.minify] minify resulting css
 * @param {boolean} [options.watch] watch mode
 * @param {array} [options.plugins] postcss plugin functions
 * @return {Object} with build (Highland Stream) and watch (Chokidar instance)
 */
function compile(options = {}) {
  let minify = options.minify || variables.minify || false,
    watch = options.watch || false,
    plugins = options.plugins || [];

  gulp.task('styles', () => {
    return h(gulp.src([componentsSrc, layoutsSrc])
      .pipe(changed(destPath, {
        transformPath,
        hasChanged
      }))
      .pipe(rename(renameFile))
      .pipe(postcss([
        cssImport(),
        autoprefixer(helpers.browserslist),
        mixins(),
        nested(),
        simpleVars({ variables })
      ].concat(plugins)))
      .pipe(gulpIf(minify, cssmin()))
      .pipe(gulp.dest(destPath))
      .pipe(es.mapSync((file) => ({ type: 'success', message: path.basename(file.path) }))));
  });

  if (watch) {
    return {
      build: gulp.task('styles')(),
      watch: gulp.watch([componentsSrc, layoutsSrc], gulp.task('styles'))
    };
  } else {
    return {
      build: gulp.task('styles')(),
      watch: null
    };
  }
}

module.exports = compile;

'use strict';
const _ = require('lodash'),
  h = require('highland'),
  afs = require('amphora-fs'),
  fs = require('fs-extra'),
  path = require('path'),
  gulp = require('gulp'),
  gulpIf = require('gulp-if'),
  rename = require('gulp-rename'),
  changed = require('gulp-changed'),
  groupConcat = require('gulp-group-concat'),
  es = require('event-stream'),
  clayHbs = require('clayhandlebars'),
  hbs = clayHbs(),
  uglify = require('uglify-js'),
  chalk = require('chalk'),
  escape = require('escape-quotes'),
  helpers = require('../../compilation-helpers'),
  destPath = path.join(process.cwd(), 'public', 'js'),
  templateGlob = 'template.+(hbs|handlebars)',
  componentsSrc = afs.getComponents().map((comp) => ({ name: comp, path: path.join(afs.getComponentPath(comp), templateGlob) })),
  layoutsSrc = afs.getLayouts().map((layout) => ({ name: layout, path: path.join(process.cwd(), 'layouts', layout, templateGlob) })),
  variables = { minify:  process.env.CLAYCLI_COMPILE_MINIFIED },
  // bundles for group concatenating (when minifying)
  bundles = helpers.generateBundles('_templates', 'js');

/**
 * replace `{{{ read 'file' }}}` helper with inlined file contents,
 * so they can be rendered client-side
 * note: this only replaces straight file reads, not reads from dynamic filepaths
 * note: we are explicitly ignoring clay-kiln, as it has other logic for inlining icons
 * @param  {string} source
 * @param  {string} filepath
 * @return {string}
 */
function inlineRead(source, filepath) {
  const staticIncludes = source.match(/\{\{\{\s?read\s?'(.*?)'\s?\}\}\}/ig),
    name = _.last(path.dirname(filepath).split(path.sep));

  let inlined = source;

  _.each(staticIncludes, function (match) {
    const filepath = match.match(/'(.*?)'/)[1];

    let fileContents;

    try {
      fileContents = escape(fs.readFileSync(filepath, 'utf8')); // read file, then escape any single-quotes
    } catch (e) {
      console.log(chalk.red(`Error replacing {{{ read \'${filepath}\' }}} in "${name}": `) + e.message);
      process.exit(1);
    }

    inlined = inlined.replace(match, fileContents);
  });
  return inlined;
}

/**
 * wrap templates so they don't render without data, see https://github.com/clay/handlebars/blob/master/index.js#L45
 * @param  {Vinyl} file
 * @return {Vinyl}
 */
function wrapTemplate(file) {
  let source = _.includes(file.path, 'clay-kiln') ? file.contents.toString('utf8') : inlineRead(file.contents.toString('utf8'), file.path);

  file.contents = new Buffer(clayHbs.wrapPartial(_.last(path.dirname(file.path).split(path.sep)), source));
  return file;
}

/**
 * precompile handlebars templates into js functions
 * @param  {Vinyl} file
 * @return {Vinyl}
 */
function precompile(file) {
  const name = _.last(path.dirname(file.path).split(path.sep));

  try {
    file.contents = new Buffer(hbs.precompile(file.contents.toString('utf8')));
    return file;
  } catch (e) {
    console.log(chalk.red(`Error precompiling template "${name}": `) + e.message);
    process.exit(1);
  }
}

/**
 * register templates by adding them to the 'window' object
 * @param  {Vinyl} file
 * @return {Vinyl}
 */
function registerTemplate(file) {
  const name = _.last(path.dirname(file.path).split(path.sep)),
    contents = file.contents.toString('utf8');

  file.contents = new Buffer(`window.kiln.componentTemplates['${name}']=${contents}\n`);
  return file;
}

/**
 * minify template js, if 'minify' argument is passed in
 * @param  {Vinyl} file
 * @param  {boolean} shouldMinify
 * @return {Vinyl}
 */
function minifyTemplate(file, shouldMinify) {
  if (!shouldMinify) {
    // don't do anything, pass it through
    return file;
  }

  try {
    const minified = uglify.minify(file.contents.toString('utf8'), { output: { inline_script: true } });

    file.contents = new Buffer(minified.code);
    return file;
  } catch (e) {
    const name = _.last(path.dirname(file.path).split(path.sep));

    console.log(chalk.red(`Error minifying template "${name}": `) + e.message);
    process.exit(1);
  }
}

/**
 * precompile handlebars templates for components and layouts
 * note: you might want to run `clay compile media` beforehand, if you have templates that read from `public/media`
 * @param {object} [options]
 * @param {boolean} [options.watch] watch mode
 * @param {boolean} [options.minify] minify resulting js
 * @return {Object} with build (Highland Stream) and watch (Chokidar instance)
 */
function compile(options = {}) {
  let watch = options.watch || false,
    minify = options.minify || variables.minify || false;

  gulp.task('templates', () => {
    let componentTasks = _.map(componentsSrc, (component) => {
        return gulp.src(component.path)
          // if NOT minifying, we compile to <name>.template.js (and check that file to determine updates)
          // if minifying, we need to pass through the component name so we can check it against the bundle
          .pipe(rename({ basename: `${component.name}.template`, extname: '.js' }))
          .pipe(changed(destPath, {
            transformPath: helpers.transformPath('_templates', destPath, minify),
            hasChanged: helpers.hasChanged
          }))
          .pipe(es.mapSync(wrapTemplate))
          .pipe(es.mapSync(precompile))
          .pipe(es.mapSync(registerTemplate))
          .pipe(es.mapSync((file) => minifyTemplate(file, minify)))
          .pipe(gulpIf(minify, groupConcat(bundles))) // when minifying, concat to '_templates-<letter>-<letter>.js'
          .pipe(gulp.dest(destPath))
          .pipe(es.mapSync((file) => ({ type: 'success', message: file.path })));
      }),
      layoutsTask = _.map(layoutsSrc, (layout) => {
        return gulp.src(layout.path)
        // if NOT minifying, we compile to <name>.template.js (and check that file to determine updates)
        // if minifying, we need to pass through the layout name so we can check it against the bundle
          .pipe(rename({ basename: `${layout.name}.template`, extname: '.js' }))
          .pipe(changed(destPath, {
            transformPath: helpers.transformPath('_templates', destPath, minify),
            hasChanged: helpers.hasChanged
          }))
          .pipe(es.mapSync(wrapTemplate))
          .pipe(es.mapSync(precompile))
          .pipe(es.mapSync(registerTemplate))
          .pipe(es.mapSync((file) => minifyTemplate(file, minify)))
          .pipe(gulpIf(minify, groupConcat(bundles))) // when minifying, concat to '_templates-<letter>-<letter>.js'
          .pipe(gulp.dest(destPath))
          .pipe(es.mapSync((file) => ({ type: 'success', message: file.path })));
      });

    return h(es.merge(componentTasks.concat(layoutsTask)));
  });

  if (watch) {
    let watchPaths = _.map(componentsSrc, (component) => component.path)
      .concat(_.map(layoutsSrc, (layout) => layout.path));

    return {
      build: gulp.task('templates')(),
      watch: gulp.watch(watchPaths, gulp.task('templates'))
    };
  } else {
    return {
      build: gulp.task('templates')(),
      watch: null
    };
  }
}

module.exports = compile;

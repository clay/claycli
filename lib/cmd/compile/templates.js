'use strict';
const _ = require('lodash'),
  h = require('highland'),
  // glob = require('glob'),
  fs = require('fs-extra'),
  afs = require('amphora-fs'),
  path = require('path'),
  gulp = require('gulp'),
  rename = require('gulp-rename'),
  groupConcat = require('gulp-group-concat'),
  through2 = require('through2'),
  clayHbs = require('clayhandlebars'),
  hbs = clayHbs(),
  uglify = require('uglify-js'),
  chalk = require('chalk'),
  escape = require('escape-quotes'),
  reporters = require('../../reporters'),
  helpers = require('../../compilation-helpers'),
  destPath = path.join(process.cwd(), 'public', 'js'),
  templateGlob = 'template.+(hbs|handlebars)',
  variables = { minify: process.env.CLAYCLI_COMPILE_MINIFIED || process.env.CLAYCLI_COMPILE_MINIFIED_TEMPLATES },
  // bundles for group concatenating (when minifying)
  bundles = helpers.generateBundles('_templates', 'js');
  // getFileCtime = _.memoize((filepath) => fs.statSync(filepath).ctime);

/**
 * determine whether a template has changed
 * if we're minifying, a template has changed if ANY of the templates that compile to the same dest file are newer than the dest file
 * otherwise, a template has changed if it's newer than its compiled version
 * @param  {boolean}  minify
 * @return {Function}
 */
/*
function hasTemplateChanged(minify) {
  return (stream, sourceFile, targetPath) => {
    if (minify) {
      // compare foo.template.js to ANY file that compiles to _templates-e-h.js
      return fs.stat(targetPath).then((targetStat) => {
        if (sourceFile.stat && sourceFile.stat.ctime > targetStat.ctime) {
          // source file is newer, push it!
          stream.push(sourceFile);
        } else {
          // source file is older, but check if any other files that compile to the same
          // _templates-x-x.js compiled file is newer
          const matcher = helpers.unbucket(path.basename(targetPath)),
            sourceGlob = path.join(process.cwd(), '@(components|layouts)', `[${matcher}]*`, templateGlob),
            sourceFiles = glob.sync(sourceGlob);

          if (_.some(sourceFiles, (sFile) => getFileCtime(sFile) > targetStat.ctime)) {
            stream.push(sourceFile);
          }
        }
      }).catch(() => {
        // targetPath doesn't exist! gotta compile the source
        stream.push(sourceFile);
      });
    } else {
      // compare foo.template.js to public/foo.template.js
      return fs.stat(targetPath).then((targetStat) => {
        if (sourceFile.stat && sourceFile.stat.ctime > targetStat.ctime) {
          stream.push(sourceFile);
        }
      }).catch(() => {
        // targetPath doesn't exist! gotta compile the source
        stream.push(sourceFile);
      });
    }
  };
}
*/

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

  file.contents = Buffer.from(clayHbs.wrapPartial(_.last(path.dirname(file.path).split(path.sep)), source), 'utf8');
  return file;
}

/**
 * precompile handlebars templates into js functions
 * @param  {Vinyl} file
 * @return {Vinyl}
 */
function precompile(file) {
  const name = path.parse(file.path).name.replace('.template', '');

  try {
    file.contents = Buffer.from(hbs.precompile(file.contents.toString('utf8')), 'utf8');
    return file;
  } catch (e) {
    console.log(chalk.red(`Error precompiling template "${name}": `) + e.message);
    throw e;
  }
}

/**
 * register templates by adding them to the 'window' object
 * @param  {Vinyl} file
 * @return {Vinyl}
 */
function registerTemplate(file) {
  const name = path.parse(file.path).name.replace('.template', ''),
    contents = file.contents.toString('utf8');

  file.contents = Buffer.from(`window.kiln.componentTemplates['${name}']=${contents}\n`, 'utf8');
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

    file.contents = Buffer.from(minified.code, 'utf8');
    return file;
  } catch (e) {
    const name = path.parse(file.path).name.replace('.template', '');

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
  const componentPaths = afs.getComponents().map((name) => path.join(afs.getComponentPath(name), templateGlob)),
    sourcePaths = componentPaths.concat([path.join(process.cwd(), 'layouts', '**', templateGlob)]);

  let watch = options.watch || false,
    minify = options.minify || variables.minify || false,
    reporter = options.reporter || 'pretty';

  function concatTemplates() {
    return minify ? groupConcat(bundles) : through2.obj((file, enc, cb) => cb(null, file));
  }

  function buildPipeline() {
    return gulp.src(sourcePaths, { base: process.cwd() })
      .pipe(rename((filepath) => {
        const name = _.last(filepath.dirname.split(path.sep));

        filepath.dirname = '';
        filepath.basename = `${name}.template`;
        filepath.extname = '.js';
      }))
      /**
       * Because there is no caching of templates like there is for scripts
       * files when we exclude unchanged files we will overwrite the chunked
       * template files with only the few templates which actually had
       * changes detected.  For the time being we will remove the exclusion of
       * unmodified templates, taking the performance penalty while
       * maintaining correct construction of the chunked template files.
       *
       * For example if we had some entrypoint like `/path/to/template.hbs`
       * which falls into `_templates-t-z.js`, everything other than template.hbs
       * would be removed from this deps file upon watch recompilation.
       * @see https://github.com/clay/claycli/issues/116#issuecomment-454110714
       */
      /*
      .pipe(changed(destPath, {
        transformPath: helpers.transformPath('_templates', destPath, minify),
        hasChanged: hasTemplateChanged(minify)
      }))
      */
      .pipe(through2.obj((file, enc, cb) => cb(null, wrapTemplate(file))))
      .pipe(through2.obj((file, enc, cb) => cb(null, precompile(file))))
      .on('error', (err) => {
        if (!watch) {
          throw err;
        }
      })
      .pipe(through2.obj((file, enc, cb) => cb(null, registerTemplate(file))))
      .pipe(through2.obj((file, enc, cb) => cb(null, minifyTemplate(file, minify))))
      .pipe(concatTemplates()) // when minifying, concat to '_templates-<letter>-<letter>.js'
      .pipe(gulp.dest(destPath))
      .pipe(through2.obj((file, enc, cb) => cb(null, { type: 'success', message: file.path })));
  }

  gulp.task('templates', () => {
    return h(buildPipeline());
  });

  gulp.task('templates:watch', cb => {
    return h(buildPipeline())
      .each((item) => {
        _.map([item], reporters.logAction(reporter, 'compile'));
      })
      .done(cb);
  });

  if (watch) {
    return {
      build: gulp.task('templates')(),
      watch: gulp.watch(sourcePaths, gulp.task('templates:watch'))
    };
  } else {
    return {
      build: gulp.task('templates')(),
      watch: null
    };
  }
}

module.exports = compile;

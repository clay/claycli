'use strict';
const _ = require('lodash'),
  h = require('highland'),
  afs = require('amphora-fs'),
  path = require('path'),
  es = require('event-stream'),
  gulp = require('gulp'),
  newer = require('gulp-newer'),
  concat = require('gulp-concat'),
  rename = require('gulp-rename'),
  gulpIf = require('gulp-if'),
  cssmin = require('gulp-cssmin'),
  reporters = require('../../reporters'),
  sourcePath = path.join(process.cwd(), 'styleguides'),
  destPath = path.join(process.cwd(), 'public'),
  // these are the font weights, styles, and formats we support
  // from https://developer.mozilla.org/en-US/docs/Web/CSS/font-weight
  fontWeights = {
    100: ['100', 'thin', 'hairline'],
    200: ['200', 'extralight', 'ultralight'],
    300: ['300', 'light'],
    400: ['400', 'normal'],
    500: ['500', 'medium'],
    600: ['600', 'semibold', 'demibold'],
    700: ['700', 'bold'],
    800: ['800', 'extrabold', 'ultrabold'],
    900: ['900', 'black', 'heavy']
  },
  fontStyles = ['normal', 'italic', 'oblique'],
  fontFormats = ['woff', 'woff2', 'otf', 'ttf'],
  variables = {
    // asset host and path are set in different environments when using separate servers/subdomains for assets
    'asset-host': process.env.CLAYCLI_COMPILE_ASSET_HOST ? process.env.CLAYCLI_COMPILE_ASSET_HOST.replace(/\/$/, '') : '',
    'asset-path': process.env.CLAYCLI_COMPILE_ASSET_PATH,
    // these arguments allow setting default env variables
    minify:  process.env.CLAYCLI_COMPILE_MINIFIED || process.env.CLAYCLI_COMPILE_MINIFIED_FONTS,
    inlined: process.env.CLAYCLI_COMPILE_INLINED_FONTS,
    linked: process.env.CLAYCLI_COMPILE_LINKED_FONTS
  };

/**
 * default 'linked' to true, if inlined is NOT set
 * @param  {boolean|undefined} linked
 * @param  {boolean} inlined
 * @return {boolean}
 */
function getLinkedSetting(linked, inlined) {
  // default linked to true UNLESS inlined is set (and linked isn't)
  if (typeof linked === 'undefined' && inlined) {
    // inlined is set, so don't link fonts
    return false;
  } else if (typeof linked === 'undefined') {
    // inlined isn't set, so link fonts by default
    return true;
  } else {
    return linked;
  }
}

/**
 * get name, style, and weight based on a font's filename
 * @param  {array} fontArray e.g. ['georgiapro', 'bold', 'italic']
 * @return {object} w/ { name, style, weight } css declarations
 */
function getFontAttributes(fontArray) {
  let name = fontArray[0], // e.g. georgiapro, note: font families are case insensitive in css
    weight, style;

  if (fontArray.length === 3) {
    // name-weight-style
    weight = _.findKey(fontWeights, (val) => _.includes(val, fontArray[1]));
    style = _.find(fontStyles, (val) => val === fontArray[2]);
  } else if (fontArray.length === 2 && _.find(fontStyles, (val) => val === fontArray[1])) {
    // name-style (note: checking for style is faster than weight, so we do that first)
    style = _.find(fontStyles, (val) => val === fontArray[1]);
  } else if (fontArray.length === 2) {
    // name-weight
    weight = _.findKey(fontWeights, (val) => _.includes(val, fontArray[1]));
  } // else it's just the name

  return {
    name: `font-family: "${name}"; `, // note: trailing spaces so they can all be concatenated
    weight: weight ? `font-weight: ${weight}; ` : '',
    style: style ? `font-style: ${style}; ` : ''
  };
}

/**
 * get filename, file format, font name, font style, and font weight
 * note: the returned 'css' is the beginning of the @font-face declaration
 * for both inlinedd and linked fonts
 * @param  {object} file
 * @param  {string} styleguide
 * @param  {boolean} isInlined
 * @return {string} @font-face declaration
 */
function getFontCSS(file, styleguide, isInlined) {
  const ext = path.extname(file.path), // e.g. '.woff'
    fileName = path.basename(file.path), // e.g. 'GeorgiaProBold.woff'
    fontAttrs = getFontAttributes(path.basename(file.path, ext).toLowerCase().split('-')),
    format = ext.slice(1); // e.g. 'woff'

  let css = `@font-face { ${fontAttrs.name}${fontAttrs.style}${fontAttrs.weight}`;

  if (isInlined) {
    css += `src: url(data:font/${format};charset=utf-8;base64,${file.contents.toString('base64')}) format("${format}"); }`;
  } else {
    let assetHost = variables['asset-host'],
      assetPath = variables['asset-path'] ? `/${variables['asset-path']}` : '';

    css += `src: url(${assetHost}${assetPath}/fonts/${styleguide}/${fileName}); }`;
  }

  file.contents = new Buffer(css);
  return file;
}

/* eslint-disable complexity */

/**
 * compile fonts from styleguides/* to public/css
 * note: linked font files are copied to public/fonts
 * @param {object} [options]
 * @param {boolean} [options.minify] minify resulting css
 * @param {boolean} [options.watch] watch mode
 * @param {boolean} [options.inlined] compile base64-inlinedd font css
 * @param {boolean} [options.linked] compile linked font css (defaults to true, unless inlined is set)
 * @return {Object} with build (Highland Stream) and watch (Chokidar instance)
 */
function compile(options = {}) {
  let styleguides = afs.getFolders(sourcePath),
    // check env variables
    minify = options.minify || variables.minify || false,
    watch = options.watch || false,
    inlined = options.inlined || variables.inlined || false,
    linked = options.linked || variables.linked || getLinkedSetting(options.linked, inlined),
    reporter = options.reporter || 'pretty';

  function buildPipeline() {
    // loop through the styleguides, generate gulp workflows that we'll later merge together
    let tasks = _.reduce(styleguides, (streams, styleguide) => {
      let fontsSrc = path.join(sourcePath, styleguide, 'fonts', `*.{${fontFormats.join(',')}}`),
        inlinedFontsTask, linkedFontsTask;

      if (inlined) {
        // define inlined fonts task
        inlinedFontsTask = gulp.src(fontsSrc)
          // if a font in the styleguide is changed, recompile the result file
          .pipe(newer({ dest: path.join(destPath, 'css', `_inlined-fonts.${styleguide}.css`), ctime: true }))
          .pipe(es.mapSync((file) => getFontCSS(file, styleguide, true)))
          .pipe(concat(`_inlined-fonts.${styleguide}.css`))
          .pipe(gulpIf(minify, cssmin()))
          .pipe(gulp.dest(path.join(destPath, 'css')))
          .pipe(es.mapSync((file) => ({ type: 'success', message: file.path })));
        streams.push(inlinedFontsTask);
      }

      if (linked) {
        // define lined fonts task
        linkedFontsTask = gulp.src(fontsSrc)
          // if a font in the styleguide is changed, recompile the result files
          .pipe(newer({ dest: path.join(destPath, 'css', `_linked-fonts.${styleguide}.css`), ctime: true }))
          // copy font file itself (to public/fonts/<styleguide>/)
          .pipe(rename({ dirname: styleguide }))
          .pipe(gulp.dest(path.join(destPath, 'fonts')))
          .pipe(es.mapSync((file) => getFontCSS(file, styleguide, false)))
          .pipe(concat(`_linked-fonts.${styleguide}.css`))
          .pipe(gulpIf(minify, cssmin()))
          .pipe(gulp.dest(path.join(destPath, 'css')))
          .pipe(es.mapSync((file) => ({ type: 'success', message: file.path })));
        streams.push(linkedFontsTask);
      }

      return streams;
    }, []);

    return es.merge(tasks);
  }

  gulp.task('fonts', () => {
    return h(buildPipeline());
  });

  gulp.task('fonts:watch', () => {
    return h(buildPipeline())
      .each((item) => {
        _.map([item], reporters.logAction(reporter, 'compile'));
      })
      .done(cb);
  });

  if (watch) {
    return {
      build: gulp.task('fonts')(),
      watch: gulp.watch(
        path.join(sourcePath, '**', 'fonts', `*.{${fontFormats.join(',')}}`),
        gulp.task('fonts:watch')
      )
    };
  } else {
    return {
      build: gulp.task('fonts')(),
      watch: null
    };
  }
}

/* eslint-enable complexity */

module.exports = compile;

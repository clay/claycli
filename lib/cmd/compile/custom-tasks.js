'use strict';
const _ = require('lodash'),
  h = require('highland'),
  es = require('event-stream');

function buildPipeline() {
  // loop through the styleguides, generate gulp workflows that we'll later merge together
  let tasks = _.reduce(styleguides, (streams, styleguide) => {
    let fontsSrc = path.join(sourcePath, styleguide, 'fonts', `*.{${fontFormats.join(',')}}`),
      inlinedFontsTask, linkedFontsTask;


      // // define inlined fonts task
      // inlinedFontsTask = gulp.src(fontsSrc)
      //   // if a font in the styleguide is changed, recompile the result file
      //   .pipe(newer({ dest: path.join(destPath, 'css', `_inlined-fonts.${styleguide}.css`), ctime: true }))
      //   .pipe(es.mapSync((file) => getFontCSS(file, styleguide, true)))
      //   .pipe(concat(`_inlined-fonts.${styleguide}.css`))
      //   .pipe(gulpIf(minify, cssmin()))
      //   .pipe(gulp.dest(path.join(destPath, 'css')))
      //   .pipe(es.mapSync((file) => ({ type: 'success', message: file.path })));
      // streams.push(inlinedFontsTask);


    return streams;
  }, []);

  return es.merge(tasks);
}

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
  // gulp.task('custom-tasks', () => {
  //   return h(buildPipeline());
  // });

  return {
    // build: gulp.task('fonts')(),
    build: () => {},
    watch: null
  };
}

module.exports = compile;

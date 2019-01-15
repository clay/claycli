'use strict';
const gulp = require('gulp'),
  _ = require('lodash'),
  h = require('highland'),
  // es = require('event-stream'),
  config = require('../../config-file-helpers');

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
  const tasks = config.getConfigValue('customTasks'),
    series = tasks.map(task => {
      console.log(`Found task... ${task.name}`);
      gulp.task(task.name, task.fn);
      return task.fn;
    });

  console.log(`Running ${tasks.length} tasks!`)
  return {
    build: gulp.series(series)(),
    watch: null
  };
}

module.exports = compile;

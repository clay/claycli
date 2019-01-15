'use strict';
const gulp = require('gulp'),
  config = require('../../config-file-helpers');

/**
 * Runs custom tasks!
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

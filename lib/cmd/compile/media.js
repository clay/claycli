'use strict';
const _ = require('lodash'),
  afs = require('amphora-fs'),
  path = require('path'),
  gulp = require('gulp'),
  rename = require('gulp-rename'),
  changed = require('gulp-changed'),
  es = require('event-stream'),
  destPath = path.join(process.cwd(), 'public', 'media'),
  mediaGlobs = '*.+(jpg|jpeg|png|gif|webp|svg|ico)',
  componentsSrc = afs.getComponents().map((comp) => ({ name: comp, path: path.join(afs.getComponentPath(comp), 'media', mediaGlobs) })),
  layoutsSrc = afs.getLayouts().map((layout) => ({ name: layout, path: path.join(process.cwd(), 'layouts', layout, 'media', mediaGlobs) })),
  styleguidesSrc = afs.getFolders(path.join(process.cwd(), 'styleguides')).map((styleguide) => ({ name: styleguide, path: path.join(process.cwd(), 'styleguides', styleguide, 'media', mediaGlobs) }));

/**
 * copy images and icons from components, layouts, and styleguide folders
 * to public/media
 * @param {object} [options]
 * @param {boolean} [options.watch] watch mode
 * @return {Object} with build (Stream) and watch (Chokidar instance)
 */
function compile(options = {}) {
  let watch = options.watch || false;

  gulp.task('media', () => {
    let componentTasks = _.map(componentsSrc, (component) => {
        return gulp.src(component.path)
          .pipe(rename({ basename: path.join('components', component.name) }))
          .pipe(changed(destPath))
          .pipe(gulp.dest(destPath))
          .pipe(es.mapSync((file) => ({ type: 'success', message: file.path })));
      }),
      layoutsTask = _.map(layoutsSrc, (layout) => {
        return gulp.src(layout.path)
          .pipe(rename({ basename: path.join('layouts', layout.name) }))
          .pipe(changed(destPath))
          .pipe(gulp.dest(destPath))
          .pipe(es.mapSync((file) => ({ type: 'success', message: file.path })));
      }),
      styleguidesTask = _.map(styleguidesSrc, (styleguide) => {
        return gulp.src(styleguide.path)
          .pipe(rename({ basename: path.join('styleguides', styleguide.name) }))
          .pipe(changed(destPath))
          .pipe(gulp.dest(destPath))
          .pipe(es.mapSync((file) => ({ type: 'success', message: file.path })));
      });

    return es.merge(componentTasks.concat(layoutsTask, styleguidesTask));
  });

  if (watch) {
    return {
      build: gulp.task('media')(),
      watch: gulp.watch(path.join(sourcePath, '**', 'fonts', `*.{${fontFormats.join(',')}}`), gulp.task('media'))
    };
  } else {
    return {
      build: gulp.task('media')(),
      watch: null
    };
  }
}

module.exports = compile;

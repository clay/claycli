'use strict';
const _ = require('lodash'),
  h = require('highland'),
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
  styleguidesSrc = afs.getFolders(path.join(process.cwd(), 'styleguides')).map((styleguide) => ({ name: styleguide, path: path.join(process.cwd(), 'styleguides', styleguide, 'media', mediaGlobs) })),
  sitesSrc = afs.getFolders(path.join(process.cwd(), 'sites')).map((site) => ({ name: site, path: path.join(process.cwd(), 'sites', site, 'media', mediaGlobs) }));

/**
 * copy images and icons from components, layouts, styleguide, and sites folders
 * to public/media
 * @param {object} [options]
 * @param {boolean} [options.watch] watch mode
 * @return {Object} with build (Highland Stream) and watch (Chokidar instance)
 */
function compile(options = {}) {
  let watch = options.watch || false;

  gulp.task('media', () => {
    let componentTasks = _.map(componentsSrc, (component) => {
        return gulp.src(component.path)
          .pipe(rename({ dirname: path.join('components', component.name) }))
          .pipe(changed(destPath))
          .pipe(gulp.dest(destPath))
          .pipe(es.mapSync((file) => ({ type: 'success', message: file.path })));
      }),
      layoutsTask = _.map(layoutsSrc, (layout) => {
        return gulp.src(layout.path)
          .pipe(rename({ dirname: path.join('layouts', layout.name) }))
          .pipe(changed(destPath))
          .pipe(gulp.dest(destPath))
          .pipe(es.mapSync((file) => ({ type: 'success', message: file.path })));
      }),
      styleguidesTask = _.map(styleguidesSrc, (styleguide) => {
        return gulp.src(styleguide.path)
          .pipe(rename({ dirname: path.join('styleguides', styleguide.name) }))
          .pipe(changed(destPath))
          .pipe(gulp.dest(destPath))
          .pipe(es.mapSync((file) => ({ type: 'success', message: file.path })));
      }),
      sitesTask = _.map(sitesSrc, (site) => {
        return gulp.src(site.path)
          .pipe(rename({ dirname: path.join('sites', site.name) }))
          .pipe(changed(destPath))
          .pipe(gulp.dest(destPath))
          .pipe(es.mapSync((file) => ({ type: 'success', message: file.path })));
      });

    return h(es.merge(componentTasks.concat(layoutsTask, styleguidesTask, sitesTask)));
  });

  if (watch) {
    let watchPaths = _.map(componentsSrc, (component) => component.path)
      .concat(
        _.map(layoutsSrc, (layout) => layout.path),
        _.map(styleguidesSrc, (styleguide) => styleguide.path),
        _.map(sitesSrc, (site) => site.path));

    return {
      build: gulp.task('media')(),
      watch: gulp.watch(watchPaths, gulp.task('media'))
    };
  } else {
    return {
      build: gulp.task('media')(),
      watch: null
    };
  }
}

module.exports = compile;

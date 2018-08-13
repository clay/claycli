'use strict';
const format = require('date-fns/format'),
  _ = require('lodash'),
  chalk = require('chalk'),
  fs = require('fs-extra'),
  path = require('path');

/**
 * determine how long a compilation task took
 * @param  {number} t2 unix timestamp
 * @param  {number} t1 unix timestamp
 * @return {string}
 */
function time(t2, t1) {
  const diff = t2 - t1;

  if (diff > 1000 * 60) {
    // more than a minute (60,000ms)
    return format(new Date(diff), 'm[m] s.SS[s]');
  } else {
    // less than a minute
    return format(new Date(diff), 's.SS[s]');
  }
}

/**
 * set up a watcher that logs when a file has changed
 * used by all scripts
 * @param  {string} e event type
 * @param  {string} filepath
 */
function watcher(e, filepath) {
  if (!_.includes(filepath, '.DS_Store')) {
    console.log(chalk.green('✓ ') + chalk.grey(filepath.replace(process.cwd(), '')));
  }
}

/**
 * determine what bucket of the alphabet the first letter of a name falls into
 * note: six buckets is the sweet spot for filesize / file bundling on http 1.1 and http2/spdy
 * note: non-alphabetic stuff goes in the last bucket, because statistically it will be the smallest
 * @param  {string} name
 * @return {string} bucket, e.g. 'a-d', 'e-h', 'i-l', 'm-p', 'q-t', 'u-z'
 */
function bucket(name) {
  if (name.match(/^[a-d]/i)) {
    return 'a-d';
  } else if (name.match(/^[e-h]/i)) {
    return 'e-h';
  } else if (name.match(/^[i-l]/i)) {
    return 'i-l';
  } else if (name.match(/^[m-p]/i)) {
    return 'm-p';
  } else if (name.match(/^[q-t]/i)) {
    return 'q-t';
  } else {
    return 'u-z';
  }
}

/**
 * find the matcher for a bucket
 * @param  {string} name e.g. _templates-a-d
 * @return {string}
 */
function unbucket(name) {
  return _.find(['a-d', 'e-h', 'i-l', 'm-p', 'q-t', 'u-z'], (matcher) => _.includes(name, matcher));
}

/**
 * generate bundles for gulp-group-concat, based on the buckets above
 * @param  {string} prefix without ending hyphen
 * @param  {string} ext without dot
 * @return {object}
 */
function generateBundles(prefix, ext) {
  return _.reduce(['a-d', 'e-h', 'i-l', 'm-p', 'q-t', 'u-z'], (bundles, matcher) => {
    bundles[`${prefix}-${matcher}.${ext}`] = `**/[${matcher}]*.${ext}`;
    return bundles;
  }, {});
}


/**
 * determine if a file has changed based on ctimes
 * @param  {Stream}  stream
 * @param  {Vinyl}  sourceFile
 * @param  {string}  targetPath
 * @return {Promise}
 */
/* istanbul ignore next */
function hasChanged(stream, sourceFile, targetPath) {
  return fs.stat(targetPath).then((targetStat) => {
    if (sourceFile.stat && sourceFile.stat.ctime > targetStat.ctime) {
      stream.push(sourceFile);
    }
  }).catch(() => {
    // targetPath doesn't exist! gotta compile the source
    stream.push(sourceFile);
  });
}

/**
 * transform the filepath if we're minifying the files and putting them into bundles
 * @param  {string} prefix e.g. '_templates', '_models'
 * @param  {string} destPath path to the destination directory
 * @param  {boolean} shouldMinify
 * @return {Functio }
 */
function transformPath(prefix, destPath, shouldMinify) {
  return (filepath) => {
    if (shouldMinify) {
      // bundle into one of six bundle files based on the first letter of the component/template
      const name = _.head(path.basename(filepath).toLowerCase().split('.'));

      return path.join(destPath, `${prefix}-${bucket(name)}.js`);
    } else {
      // no changes, use the path from rename()
      return filepath;
    }
  };
}

module.exports.time = time;
module.exports.debouncedWatcher = _.debounce(watcher, 200);
module.exports.bucket = bucket;
module.exports.unbucket = unbucket;
module.exports.generateBundles = generateBundles;
module.exports.hasChanged = hasChanged;
module.exports.transformPath  = transformPath;
module.exports.autoprefixOptions = { browsers: ['last 2 versions', 'ie >= 9', 'ios >= 7', 'android >= 4.4.2'] }; // used by styles and vueify (kiln plugin templates)

// for testing
module.exports.watcher = watcher;

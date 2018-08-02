'use strict';
const format = require('date-fns/format'),
  _ = require('lodash'),
  chalk = require('chalk');

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

function watcher(e, filepath) {
  if (!_.includes(filepath, '.DS_Store')) {
    console.log(chalk.green('✓ ') + chalk.grey(filepath.replace(process.cwd(), '')));
  }
}

/**
 * determine what bucket of the alphabet the first letter of a name falls into
 * note: six buckets is the sweet spot for filesize / file bundling on http 1.1 and http2/spdy
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
  } else if (name.match(/^[u-z]/i)) {
    return 'u-z';
  } else {
    throw new Error(`First letter of "${name}" doesn't exist in the alphabet!`);
  }
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

module.exports.time = time;
module.exports.debouncedWatcher = _.debounce(watcher, 200);
module.exports.bucket = bucket;
module.exports.generateBundles = generateBundles;

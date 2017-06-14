const bluebird = require('bluebird'),
  scripts = require('./scripts'),
  templates = require('./templates'),
  styles = require('./styles');

/**
 * compile everything
 * @param  {string} filepath
 * @param  {object} argv
 * @return {Promise}
 */
function all(filepath, argv) {
  return bluebird.all([
    scripts(filepath, argv),
    templates(filepath, argv),
    styles(filepath, argv)
  ]);
}

module.exports = {
  all,
  scripts,
  templates,
  styles
};

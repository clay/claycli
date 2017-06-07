const bluebird = require('bluebird'),
  models = require('./models'),
  controllers = require('./controllers'),
  kiln = require('./kiln'),
  templates = require('./templates');

/**
 * compile all scripts
 * @param  {string} filepath
 * @param  {object} argv
 * @return {Promise}
 */
function scripts(filepath, argv) {
  return bluebird.all([
    models(filepath, argv),
    controllers(filepath, argv),
    kiln(filepath, argv),
    templates(filepath, argv)
  ]);
}

/**
 * compile everything
 * @param  {string} filepath
 * @param  {object} argv
 * @return {Promise}
 */
function all(filepath, argv) {
  return bluebird.all([
    scripts(filepath, argv)
  ]);
}

module.exports = {
  all,
  scripts
};

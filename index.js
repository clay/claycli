'use strict';

// programmatic api

module.exports.config = require('./lib/cmd/config');
module.exports.lint = require('./lib/cmd/lint');
module.exports.import = require('./lib/cmd/import');
module.exports.export = require('./lib/cmd/export');
module.exports.compile = require('./lib/cmd/compile');
module.exports.gulp = require('gulp'); // A reference to the Gulp instance so that external tasks can reference a common package

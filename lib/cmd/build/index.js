'use strict';

const { build, watch, getEsbuildConfig, generateClientEnv, GLOBALS_INIT_ENTRY_KEY } = require('./scripts');
const { getDependenciesNext, getDependenciesNextForComponents, hasManifest, getTemplatePaths, getEditScripts } = require('./get-script-dependencies');

exports.build = build;
exports.watch = watch;
exports.getEsbuildConfig = getEsbuildConfig;
exports.generateClientEnv = generateClientEnv;
exports.GLOBALS_INIT_ENTRY_KEY = GLOBALS_INIT_ENTRY_KEY;
exports.getDependenciesNext = getDependenciesNext;
exports.getDependenciesNextForComponents = getDependenciesNextForComponents;
exports.hasManifest = hasManifest;
exports.getTemplatePaths = getTemplatePaths;
exports.getEditScripts = getEditScripts;

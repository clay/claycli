'use strict';

const { build, watch, getEsbuildConfig, generateClientEnv } = require('./scripts');
const { getDependenciesNext, getDependenciesNextForComponents, hasManifest, getTemplatePaths, getEditScripts } = require('./get-script-dependencies');

exports.build = build;
exports.watch = watch;
exports.getEsbuildConfig = getEsbuildConfig;
exports.generateClientEnv = generateClientEnv;
exports.getDependenciesNext = getDependenciesNext;
exports.getDependenciesNextForComponents = getDependenciesNextForComponents;
exports.hasManifest = hasManifest;
exports.getTemplatePaths = getTemplatePaths;
exports.getEditScripts = getEditScripts;

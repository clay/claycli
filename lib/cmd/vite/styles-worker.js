'use strict';

// Worker thread for the styles step.  Loads claycli.config.js from the project
// root and runs the stylesConfig hook itself (its PostCSS plugins cannot be sent
// across threads), then compiles the files the main thread posts to it.

const path = require('path');
const { parentPort, workerData } = require('worker_threads');
const amphoraFs = require('amphora-fs');
const { resolveStylesConfig, createCompiler } = require('./styles-compiler');

const { root, minify, variables, targets } = workerData;
const configFile = amphoraFs.tryRequire(path.join(root, 'claycli.config')) || {};
const config = resolveStylesConfig(key => configFile[key], { minify });
const compiler = createCompiler({ root, config, variables, targets });

parentPort.on('message', ({ id, src, dest }) => {
  compiler.compile(src, dest).then(
    ({ errors }) => parentPort.postMessage({ id, errors }),
    err => parentPort.postMessage({ id, failure: err.message })
  );
});

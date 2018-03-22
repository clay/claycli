'use strict';

const chalk = require('chalk'),
  config = require('./config'),
  nyanCat = require('nyansole'),
  isCat = config.get('toolConfig.nyancat'),
  nyanProgress = isCat ? new nyanCat() : null;

function initCat() {
  if (isCat) {
    nyanProgress.reset();
    nyanProgress.start();
  }
}

function tick() {
  if (!isCat) {
    process.stdout.write(chalk.green('.'));
  }
}

function interrupt() {
  if (!isCat) {
    process.stdout.write(chalk.red('.'));
  } else {
    nyanProgress.stop();
  }
}

function end() {
  if (isCat) {
    nyanProgress.end();
  }
}

module.exports.end = end;
module.exports.isCat = isCat;
module.exports.interrupt = interrupt;
module.exports.initCat = initCat;
module.exports.tick = tick;

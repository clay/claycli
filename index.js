#!/usr/bin/env node
'use strict'; // eslint-disable-line

const yargs = require('yargs'),
  path = require('path'),
  updateNotifier = require('update-notifier'),
  pkg = require('./package.json'),
  logger = require('./lib/utils/logger'),
  options = require('./lib/utils/shared-options'),
  notifier = updateNotifier({
    pkg,
    // updateCheckInterval: 1000 * 60 * 60 * 24 * 7 // 1 week
  });

if (notifier.update) {
  notifier.notify();
  process.exit(0);
}

let argv = yargs
  .usage('Usage: clay <command> [options]')
  .wrap(yargs.terminalWidth())
  .option('V', options.verbose).argv;

// set log level before instantiating commands
logger.init(argv.verbose);

yargs.commandDir(path.join('lib', 'cmd'))
  // common options
  .help()
  .version()
  .alias({
    h: 'help',
    v: 'version'
  })
  .demandCommand(1, 'What would you like to do today?')
  .completion()
  .argv;

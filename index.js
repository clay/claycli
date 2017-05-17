#!/usr/bin/env node
'use strict'; // eslint-disable-line
const yargs = require('yargs'),
  logger = require('./lib/utils/logger');

let argv = yargs.usage('Usage: clay <command> [options]')
  .wrap(yargs.terminalWidth())
  // commands
  .commandDir('cmd')
  // common options
  .help()
  .version()
  .alias({
    h: 'help',
    v: 'version'
  })
  .demandCommand(1, 'What would you like to do today?')
  .argv;

// set log level
logger.setLogLevel(argv.verbose);

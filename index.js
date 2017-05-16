#!/usr/bin/env node
'use strict'; // eslint-disable-line
const yargs = require('yargs');

yargs.usage('Usage: clay <command> [options]')
  // commands
  // common options
  .help()
  .version()
  .alias({
    h: 'help',
    v: 'version'
  })
  .demandCommand(1, 'What would you like to do today?')
  .argv;

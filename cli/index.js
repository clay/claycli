#!/usr/bin/env node
'use strict'; // eslint-disable-line

// force colors.js to use colors when exporting
// by passing a SECRET HIDDEN FLAG into claycli, which triggers
// terminal-logger's colors.js checker
process.argv.push('--color');
process.argv.push('always');

// command line interface

const yargs = require('yargs'),
  updateNotifier = require('update-notifier'),
  pkg = require('../package.json'),
  notifier = updateNotifier({
    pkg
  });

if (notifier.update) {
  // note: this will only check for updates once per day
  notifier.notify();
  process.exit(0);
}

yargs
  .usage('Usage: clay <command> [options]')
  .wrap(yargs.terminalWidth())
  .command(require('./config'))
  .command(require('./lint'))
  .command(require('./import'))
  .command(require('./export'))
  .command(require('./compile'))
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

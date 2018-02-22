#!/usr/bin/env node
'use strict'; // eslint-disable-line

const yargs = require('yargs'),
  updateNotifier = require('update-notifier'),
  pkg = require('./package.json'),
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
  .commandDir('cmd')
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

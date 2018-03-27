'use strict';
const _ = require('lodash'),
  chalk = require('chalk'),
  options = require('./cli-options'),
  reporter = require('../lib/reporters'),
  config = require('../lib/cmd/config');

function builder(yargs) {
  return yargs
    .usage('Usage: $0 config [value]')
    .example('$0 config --key local', 'View local api key')
    .example('$0 config --key prod as8d7s9d', 'Set prod api key')
    .example('$0 config --url some-article', 'Get url')
    .example('$0 config --url mysite domain.com', 'Set url')
    .option('k', options.key)
    .option('u', options.url)
    .option('r', options.reporter);
}

function set(argv) {
  if (argv.key) {
    config.set('key', argv.key, argv.value);
    reporter.logSummary(argv.reporter, 'config', () => ({ success: true, message: `set ${argv.key} ${argv.value}` }))([]);
  } else if (argv.url) {
    config.set('url', argv.url, argv.value);
    reporter.logSummary(argv.reporter, 'config', () => ({ success: true, message: `set ${argv.url} ${argv.value}` }))([]);
  } else {
    reporter.logSummary(argv.reporter, 'config', () => ({ success: false, message: 'Please provide either --key or --url' }))([]);
    process.exit(1);
  }
}

function get(argv) {
  let type, key, val;

  if (argv.key) {
    type = 'key';
    key = argv.key;
    val = config.get('key', argv.key);
  } else if (argv.url) {
    type = 'url';
    key = argv.url;
    val = config.get('url', argv.url);
  } else if (argv.reporter !== 'json') {
    // pretty print all config options
    reporter.logSummary(argv.reporter, 'config', () => ({ success: true, message: `Raw Config Values:\n${_.reduce(config.getAll(), (str, items, type) => {
      if (type === '__filename') {
        return str;
      }

      return str += `${chalk.blue(type)}:\n${_.reduce(items, (itemsStr, itemVal, itemKey) => {
        return itemsStr += `${chalk.bold(itemKey)} = ${itemVal}\n`;
      }, '')}\n`;
    }, '')}`}))([]);
    process.exit(0);
  } else {
    // json-print all config options
    reporter.logSummary(argv.reporter, 'config', () => ({ success: true, message: `Raw Config Values:\n${JSON.stringify(config.getAll())}` }))([]);
    process.exit(0);
  }

  // normally, we'd want to pass through any alias,
  // but here we're explicitly checking to see if the alias exists in the config
  if (!_.includes([key, `http://${key}`, process.env.CLAYCLI_DEFAULT_KEY, process.env.CLAYCLI_DEFAULT_URL], val)) {
    reporter.logSummary(argv.reporter, 'config', () => ({ success: true, message: val }))([]);
  } else {
    reporter.logSummary(argv.reporter, 'config', () => ({ success: false, message: `${type}: ${key} not found` }))([]);
  }
}

function handler(argv) {
  if (argv.value) {
    // set values
    set(argv);
  } else {
    get(argv);
  }
}

module.exports = {
  command: 'config [value]',
  describe: 'View or set config variables',
  aliases: ['configure', 'cfg'],
  builder,
  handler
};

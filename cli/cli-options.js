'use strict';

module.exports = {
  verbose: {
    alias: 'verbose', // -v, --verbose
    describe: 'print debug logs',
    type: 'boolean'
  },
  url: {
    alias: 'url', // -u, --url
    describe: 'url or alias from config',
    type: 'string',
    requiresArg: true
  },
  key: {
    alias: 'key', // -k, --key
    describe: 'api key or alias from config',
    type: 'string',
    requiresArg: true
  },
  size: {
    alias: 'size', // -s, --size
    describe: 'number of pages to query for',
    type: 'number',
    default: 10,
    requiresArg: true
  },
  concurrency: {
    alias: 'concurrency', // -c, --concurrency
    describe: 'number of concurrent requests against clay',
    type: 'number',
    default: 10,
    requiresArg: true
  },
  publish: {
    alias: 'publish', // -p, --publish
    describe: 'publish items when importing',
    type: 'boolean'
  },
  yaml: {
    alias: 'yaml', // -y, --yaml
    describe: 'parse bootstrap format',
    type: 'boolean'
  }
};

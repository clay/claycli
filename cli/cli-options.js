'use strict';

module.exports = {
  reporter: {
    alias: 'reporter', // -r, --reporter
    describe: 'how to print logs',
    type: 'string',
    requiresArg: true
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
  layout: {
    alias: 'layout', // -l, --layout
    describe: 'export layout when exporting page(s)',
    type: 'boolean'
  },
  yaml: {
    alias: 'yaml', // -y, --yaml
    describe: 'parse bootstrap format',
    type: 'boolean'
  }
};

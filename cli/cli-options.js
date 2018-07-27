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
    alias: 'layout', // -l, --layout (note: -l is also used when compiling fonts)
    describe: 'export layout when exporting page(s)',
    type: 'boolean'
  },
  yaml: {
    alias: 'yaml', // -y, --yaml
    describe: 'parse bootstrap format',
    type: 'boolean'
  },
  // compilation options
  minify: {
    alias: 'minify', // -m, --minify
    describe: 'run through minification',
    type: 'boolean'
  },
  watch: {
    alias: 'watch', // -w, --watch
    describe: 'watch files and recompile on changes',
    type: 'boolean'
  },
  inlined: {
    alias: 'inlined', // -i, --inlined
    describe: 'compile base64 inlined fonts',
    type: 'boolean'
  },
  linked: {
    alias: 'linked', // -l, --linked (note: -l is also used when exporting layouts)
    describe: 'compile linked fonts',
    type: 'boolean',
    default: undefined // will be undefined if unset
  }
};

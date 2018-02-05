'use strict';

module.exports = {
  verbose: {
    alias: 'verbose', // -v, --verbose
    describe: 'print debug logs',
    type: 'boolean'
  },
  site: {
    alias: 'site', // -s, --site
    describe: 'site url or alias from .clayconfig',
    type: 'string',
    requiresArg: true
  },
  key: {
    alias: 'key', // -k, --key
    describe: 'api key or alias from .clayconfig',
    type: 'string',
    requiresArg: true
  },
  dryRun: {
    alias: 'dry-run', // -n, --dry-run
    describe: 'preview the command without executing it',
    type: 'boolean'
  },
  force: {
    // no aliases
    describe: 'suppress confirmation messages',
    type: 'boolean'
  },
  file: {
    alias: 'file', // -f, --file
    describe: 'file/directory or alias from .clayconfig',
    type: 'string',
    normalize: true
  },
  recursive: {
    alias: 'recursive', // -r, --recursive
    describe: 'run command against children and child folders',
    type: 'boolean'
  },
  page: {
    alias: 'page', // -p, --page
    describe: 'specific page uri',
    type: 'string'
  },
  component: {
    alias: 'component', // -c, --component
    describe: 'specific component uri',
    type: 'string'
  },
  users: {
    alias: 'users', // -u, --users
    describe: 'import users?',
    type: 'boolean',
    default: false
  },
  lists: {
    // no aliases
    describe: 'import lists?',
    type: 'boolean',
    default: false
  },
  limit: {
    alias: 'limit', // -l, --limit
    describe: 'limit to specific number of pages',
    type: 'number',
    default: 100
  },
  offset: {
    alias: 'offset', // -o, --offset
    describe: 'offset by specific number of pages',
    type: 'number',
    default: 0
  },
  query: {
    alias: 'query', // -q, --query
    describe: 'path to elastic query yaml/json',
    type: 'string',
    normalize: true
  },
  concurrency: {
    // no aliases
    describe: 'number of concurrent requests against clay',
    type: 'number',
    default: 10
  },
  headers: {
    // no aliases
    demand: false,
    nargs: 1,
    describe: 'headers that may be required for requests to clay, e.g. X-Forwarded-Host:clay-site.com',
    type: 'string'
  },
  published: {
    // no aliases
    demand: false,
    describe: 'only published instances, e.g. site.com/components/a/instances/b@published',
    type: 'boolean',
    default: false
  }
};

module.exports = {
  verbose: {
    alias: 'verbose', // -v, --verbose
    describe: 'print debug logs',
    type: 'boolean'
  },
  site: {
    alias: 'site', // -s, --site
    describe: 'site url or alias from .gitconfig',
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
    describe: 'file or directory to affect',
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
    alias: 'concurrency', // -c, --concurrency
    describe: 'number of concurrent requests against clay',
    type: 'number',
    default: 10
  }
};

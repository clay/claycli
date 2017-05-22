module.exports = {
  verbose: {
    alias: 'verbose', // -V, --verbose (lowercase -v is 'print version and exit')
    describe: 'print debug logs',
    type: 'boolean'
  },
  site: {
    alias: 'site', // -s, --site
    describe: 'site url or alias from .clayconfig',
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
    describe: 'file path or alias from .clayconfig',
    type: 'string',
    normalize: true,
    requiresArg: true
  },
  recursive: {
    alias: 'recursive', // -r, --recursive
    describe: 'run command against children and child folders',
    type: 'boolean'
  },
  component: {
    alias: 'component', // -c, --component
    describe: 'component uri',
    type: 'string',
    requiresArg: true
  },
  page: {
    alias: 'page', // -p, --page
    describe: 'page uri',
    type: 'string',
    requiresArg: true
  },
  key: {
    alias: 'key', // -k, --key
    describe: 'api key or alias from .clayconfig',
    type: 'string',
    requiresArg: true
  }
};

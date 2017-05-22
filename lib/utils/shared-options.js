module.exports = {
  verbose: {
    alias: 'verbose',
    describe: 'print debug logs',
    type: 'boolean'
  },
  site: {
    alias: 'site', // should be defined on your command as .option('s', options.site) so the help lists it as "-s, --site"
    describe: 'site url or alias from .gitconfig',
    type: 'string',
    requiresArg: true
  },
  dryRun: {
    alias: 'dry-run', // .option('n', options.dryRun)
    describe: 'preview the command without executing it',
    type: 'boolean'
  },
  force: {
    // no aliases
    describe: 'suppress confirmation messages',
    type: 'boolean'
  },
  file: {
    alias: 'file',
    describe: 'file or directory to affect',
    type: 'string',
    normalize: true
  },
  recursive: {
    alias: 'recursive',
    describe: 'run command against children and child folders',
    type: 'boolean'
  }
};

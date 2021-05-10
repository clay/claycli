'use strict';

module.exports = {
  asset: [
    'asset',
    {
      description: 'compile a specific asset type',
      type: 'string'
    }
  ],
  globs: [
    'globs',
    {
      array: true,
      alias: ['g'],
      default: ['./components/**/client.pack.js'],
      description: 'optional list of glob patterns to compile',
      type: 'array'
    }
  ]
};

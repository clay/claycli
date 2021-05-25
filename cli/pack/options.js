'use strict';

module.exports = {
  globs: [
    'globs',
    {
      array: true,
      alias: ['g'],
      default: ['./components/**/client.js'],
      description: 'optional list of glob patterns to compile',
      type: 'array'
    }
  ]
};

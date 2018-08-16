'use strict';
const lib = require('./types');

describe('clay data types', () => {
  it('includes all data types', () => {
    expect(lib).toEqual([
      '/_layouts',
      '/_components',
      '/_pages',
      '/_users',
      '/_uris',
      '/_lists'
    ]);
  });
});

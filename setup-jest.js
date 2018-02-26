'use strict';
const Highland = require('highland');

// global version of highland that implicitly uses native promises
// so we don't have to pass in noise in our tests
global.h = Highland.use({
  toPromise() {
    return Highland.toPromise(Promise, this);
  }
});

// global version of fetch that's properly mocked
global.fetch = require('jest-fetch-mock');

jest.setMock('isomorphic-fetch', fetch);

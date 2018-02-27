'use strict';
const Highland = require('highland'),
  mockDebug = jest.fn(),
  mockWarn = jest.fn(),
  mockError = jest.fn(),
  mockLoad = jest.fn();

// config mocking
jest.doMock('home-config', () => ({
  load: mockLoad
}));

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
jest.setMock('./lib/logger', () => ({
  debug: mockDebug,
  warn: mockWarn,
  error: mockError
}));

'use strict';
const mockDebug = jest.fn(),
  mockWarn = jest.fn(),
  mockError = jest.fn(),
  mockLoad = jest.fn();

// config mocking
jest.doMock('home-config', () => ({
  load: mockLoad
}));

// global version of fetch that's properly mocked
global.fetch = require('jest-fetch-mock');

jest.setMock('isomorphic-fetch', fetch);
jest.setMock('./lib/debug-logger', () => ({
  debug: mockDebug,
  warn: mockWarn,
  error: mockError
}));

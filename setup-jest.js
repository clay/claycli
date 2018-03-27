'use strict';
const mockLoad = jest.fn();

// config mocking
jest.doMock('home-config', () => ({
  load: mockLoad
}));

// global version of fetch that's properly mocked
global.fetch = require('jest-fetch-mock');

jest.setMock('isomorphic-fetch', fetch);

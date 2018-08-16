'use strict';

// mock npm modules
jest.doMock('home-config', () => ({
  load: jest.fn()
}));

// global version of fetch that's properly mocked
global.fetch = require('jest-fetch-mock');

jest.setMock('isomorphic-fetch', fetch);

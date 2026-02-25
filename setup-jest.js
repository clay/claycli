'use strict';

// mock npm modules
jest.doMock('home-config', () => ({
  load: jest.fn()
}));

// global version of fetch that's properly mocked
require('jest-fetch-mock').enableMocks();

jest.setMock('isomorphic-fetch', fetch);

/* eslint-env jest */

'use strict';

const lib = require('./config-file-helpers'),
  amphoraFs = require('amphora-fs');

// Mock tryRequire
amphoraFs.tryRequire = jest.fn();

describe('project specific config file helpers', () => {
  describe('getConfigFile', () => {
    const fn = lib.getConfigFile;

    it('returns undefined if the file is not found', () => {
      expect(fn()).toBe(undefined);
    });

    it('returns a file if one is found', () => {
      amphoraFs.tryRequire.mockReturnValue({});

      expect(fn()).toEqual({});
    });
  });

  describe('getConfigValue', () => {
    const fn = lib.getConfigValue,
      SAMPLE_CONFIG = {
        babelTargets: 'some value',
        autoprefixerOptions: { foo: true, bar: false }
      };

    beforeEach(() => {
      lib.setConfigFile(SAMPLE_CONFIG);
    });

    it('returns undefined if the config file is not present', () => {
      lib.setConfigFile(undefined);

      expect(fn('babelTargets')).toBe(undefined);
    });

    it('returns a value from the config if it exists', () => {
      expect(fn('babelTargets')).toBe('some value');
      expect(fn('autoprefixerOptions')).toEqual({ foo: true, bar: false});
    });

    it('returns undefined if the value does not exist', () => {
      expect(fn('fakeVal')).toBe(undefined);
    });
  });
});

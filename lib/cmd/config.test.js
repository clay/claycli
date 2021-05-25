/* eslint-env jest */

'use strict';
const lib = require('./config'),
  config = require('home-config');

describe('config', () => {
  describe('get', () => {
    const empty = { keys: {}, urls: {} };

    it('throws error if unknown section', () => {
      expect(() => lib.get('foo')).toThrow('Unknown config section "foo"');
    });

    it('returns undefined key', () => {
      config.load.mockReturnValueOnce(empty);
      expect(lib.get('key')).toBe(undefined);
    });

    it('returns passed through key', () => {
      config.load.mockReturnValueOnce(empty);
      expect(lib.get('key', 'abc')).toBe('abc');
    });

    it('returns CLAYCLI_DEFAULT_KEY', () => {
      config.load.mockReturnValueOnce(empty);
      process.env.CLAYCLI_DEFAULT_KEY = 'def';
      expect(lib.get('key')).toBe('def');
      process.env.CLAYCLI_DEFAULT_KEY = undefined;
    });

    it('returns saved key', () => {
      config.load.mockReturnValueOnce({ keys: { ghi: '123' }, urls: {} });
      expect(lib.get('key', 'ghi')).toBe('123');
    });

    it('returns undefined url', () => {
      config.load.mockReturnValueOnce(empty);
      expect(lib.get('url')).toBe(undefined);
    });

    it('returns passed through url', () => {
      config.load.mockReturnValueOnce(empty);
      expect(lib.get('url', 'domain.com')).toBe('http://domain.com');
    });

    it('passes through https urls', () => {
      config.load.mockReturnValueOnce(empty);
      expect(lib.get('url', 'https://domain.com')).toBe('https://domain.com');
    });

    it('sanitizes trailing slashes on urls', () => {
      config.load.mockReturnValueOnce(empty);
      expect(lib.get('url', 'http://domain.com/')).toBe('http://domain.com');
    });

    it('returns CLAYCLI_DEFAULT_URL', () => {
      config.load.mockReturnValueOnce(empty);
      process.env.CLAYCLI_DEFAULT_URL = 'domain.com';
      expect(lib.get('url')).toBe('http://domain.com');
      process.env.CLAYCLI_DEFAULT_URL = undefined;
    });

    it('returns saved url', () => {
      config.load.mockReturnValueOnce({ keys: {}, urls: { me: 'domain.com' } });
      expect(lib.get('url', 'me')).toBe('http://domain.com');
    });
  });

  describe('getAll', () => {
    it('gets all config options', () => {
      const configObj = {
        keys: {
          a: 'b',
        },
        urls: {
          c: 'd'
        }
      };

      config.load.mockReturnValueOnce(configObj);
      expect(lib.getAll()).toEqual(configObj);
    });
  });

  describe('set', () => {
    it('throws error if unknown section', () => {
      expect(() => lib.set('foo')).toThrow('Unknown config section "foo"');
    });

    it('saves key', () => {
      let mockSave = jest.fn();

      config.load.mockReturnValueOnce({ save: mockSave });
      lib.set('key', 'ghi');
      expect(mockSave).toHaveBeenCalled();
    });

    it('saves url', () => {
      let mockSave = jest.fn();

      config.load.mockReturnValueOnce({ save: mockSave });
      lib.set('url', 'domain.com');
      expect(mockSave).toHaveBeenCalled();
    });
  });
});

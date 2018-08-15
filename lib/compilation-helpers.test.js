'use strict';

const lib = require('./compilation-helpers'),
  mockConsole = require('jest-mock-console').default;

describe('compilation helpers', () => {
  describe('time', () => {
    const fn = lib.time;

    it('returns minutes and seconds when time is longer than a minute', () => {
      const t1 = new Date(0),
        t2 = new Date(1000 * 62); // 1m 2s

      expect(fn(t2, t1)).toBe('1m 2.00s');
    });

    it('returns seconds when time is less than a minute', () => {
      const t1 = new Date(0),
        t2 = new Date(1000 * 48.5); // 48.50s

      expect(fn(t2, t1)).toBe('48.50s');
    });
  });

  describe('watcher', () => {
    const fn = lib.watcher;

    it('does not log .DS_Store files', () => {
      const restoreConsole = mockConsole();

      fn(null, '/some/path/with/.DS_Store');
      expect(console.log).not.toHaveBeenCalled();
      restoreConsole();
    });

    it('logs when called with another file', () => {
      const restoreConsole = mockConsole();

      fn(null, '/some/path/with/a.file');
      expect(console.log).toHaveBeenCalled();
      restoreConsole();
    });
  });

  describe('bucket', () => {
    const fn = lib.bucket;

    it('returns first bucket', () => {
      expect(fn('alpha')).toBe('a-d');
    });

    it('returns second bucket', () => {
      expect(fn('foxtrot')).toBe('e-h');
    });

    it('returns third bucket', () => {
      expect(fn('kilo')).toBe('i-l');
    });

    it('returns fourth bucket', () => {
      expect(fn('papa')).toBe('m-p');
    });

    it('returns fifth bucket', () => {
      expect(fn('quebec')).toBe('q-t');
    });

    it('returns sixth bucket', () => {
      expect(fn('victor')).toBe('u-z');
    });

    it('puts numbers in the sixth bucket', () => {
      expect(fn('0451')).toBe('u-z');
    });

    it('puts non-alphanumeric characters in the sixth bucket', () => {
      expect(fn('_someFile')).toBe('u-z');
    });
  });

  describe('unbucket', () => {
    const fn = lib.unbucket;

    it('returns matcher for bucket', () => {
      expect(fn('_deps-a-d.js')).toBe('a-d');
    });
  });

  describe('generateBundles', () => {
    const fn = lib.generateBundles;

    it('generates template bundles', () => {
      expect(fn('_templates', 'js')['_templates-a-d.js']).toEqual('**/[a-d]*.js');
    });
  });

  describe('transformPath', () => {
    const fn = lib.transformPath;

    it('does not transform unminified paths', () => {
      expect(fn('_templates', 'public/js', false)('/path/to/file.js')).toBe('/path/to/file.js');
    });

    it('transforms minified paths', () => {
      expect(fn('_templates', 'public/js', true)('/path/to/file.js')).toBe('public/js/_templates-e-h.js');
    });
  });
});

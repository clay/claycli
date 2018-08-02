'use strict';

const lib = require('./compilation-helpers');

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

    it('throws error if first letter does not match', () => {
      expect(() => fn('0451')).toThrow('First letter of "0451" doesn\'t exist in the alphabet!');
    });
  });

  describe('generateBundles', () => {
    const fn = lib.generateBundles;

    it('generates template bundles', () => {
      expect(fn('_templates', 'js')['_templates-a-d.js']).toEqual('**/[a-d]*.js');
    });
  });
});

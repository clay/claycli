'use strict';

const lib = require('./composer');

describe('normalize component data', () => {
  describe('normalize', () => {
    const fn = lib.normalize;

    it('cleans component lists', () => {
      expect(fn({ a: [{
        _ref: 'foo',
        b: 'c'
      }] })).toEqual({ a: [{ _ref: 'foo' }]});
    });

    it('passes through other arrays', () => {
      const data = { a: ['b', 'c'] };

      expect(fn(data)).toEqual(data);
    });

    it('cleans component props', () => {
      expect(fn({ a: {
        _ref: 'foo',
        b: 'c'
      } })).toEqual({ a: { _ref: 'foo' }});
    });

    it('passes through other objects', () => {
      const data = { a: { b: true, c: true } };

      expect(fn(data)).toEqual(data);
    });

    it('passes through other data', () => {
      const data = {
        a: 'some string',
        b: false,
        c: 0,
        d: null,
        e: '',
        f: [],
        g: {}
      };

      expect(fn(data)).toEqual(data);
    });

    it('removes root-level _ref', () => {
      expect(fn({ _ref: 'foo', a: 'b' })).toEqual({ a: 'b' });
    });
  });

  describe('denormalize', () => {
    const fn = lib.denormalize,
      bootstrap = {
        _components: {
          a: {
            child: [{
              _ref: '/_components/b'
            }],
            instances: {
              1: {
                child: [{
                  _ref: '/_components/b/instances/1'
                }]
              }
            }
          },
          b: {
            c: 'd',
            instances: {
              1: {
                c: 'd'
              }
            }
          }
        }
      },
      bootstrapDeep = {
        _components: {
          a: {
            instances: {
              1: {
                child: [{
                  _ref: '/_components/b/instances/1'
                }]
              }
            }
          },
          b: {
            instances: {
              1: {
                child: {
                  _ref: '/_components/c/instances/1'
                }
              }
            }
          },
          c: {
            instances: {
              1: {
                d: 'e'
              }
            }
          }
        }
      };

    it('skips empty refs if not in the data', () => {
      expect(fn({ _ref: '/_components/a', child: [{ _ref: '/_components/b' }]}, {}, {})).toEqual({
        _ref: '/_components/a',
        child: [{
          _ref: '/_components/b'
        }]
      });
    });

    it('adds component lists', () => {
      expect(fn({ _ref: '/_components/a', child: [{ _ref: '/_components/b' }]}, bootstrap, {})).toEqual({
        _ref: '/_components/a',
        child: [{
          _ref: '/_components/b',
          c: 'd'
        }]
      });
    });

    it('adds component lists with instances', () => {
      expect(fn({ _ref: '/_components/a/instances/1', child: [{ _ref: '/_components/b/instances/1' }]}, bootstrap, {})).toEqual({
        _ref: '/_components/a/instances/1',
        child: [{
          _ref: '/_components/b/instances/1',
          c: 'd'
        }]
      });
    });

    it('passes through other arrays', () => {
      const data = { a: ['b', 'c'] };

      expect(fn(data, bootstrap, {})).toEqual(data);
    });

    it('adds component props', () => {
      expect(fn({ _ref: '/_components/a', child: { _ref: '/_components/b' }}, bootstrap, {})).toEqual({
        _ref: '/_components/a',
        child: {
          _ref: '/_components/b',
          c: 'd'
        }
      });
    });

    it('passes through other objects', () => {
      const data = { a: { b: true, c: true } };

      expect(fn(data, bootstrap, {})).toEqual(data);
    });

    it('passes through other data', () => {
      const data = {
        _ref: '/_components/a',
        a: 'some string',
        b: false,
        c: 0,
        d: null,
        e: '',
        f: [],
        g: {}
      };

      expect(fn(data, bootstrap, {})).toEqual(data);
    });

    it('retains root-level _ref', () => {
      expect(fn({ _ref: 'foo', a: 'b' })).toEqual({ _ref: 'foo', a: 'b' });
    });

    it('composes deep objects', () => {
      expect(fn({ _ref: '/_components/a/instances/1', child: [{ _ref: '/_components/b/instances/1' }]}, bootstrapDeep, {})).toEqual({
        _ref: '/_components/a/instances/1',
        child: [{
          _ref: '/_components/b/instances/1',
          child: {
            _ref: '/_components/c/instances/1',
            d: 'e'
          }
        }]
      });
    });
  });
});

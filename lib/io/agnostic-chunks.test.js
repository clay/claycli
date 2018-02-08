'use strict';

const lib = require('./agnostic-chunks'),
  prefix = 'domain.com',
  foo = '/_components/foo',
  bar = '/_components/bar',
  fullFoo = prefix + foo,
  fullBar = prefix + bar;

describe('agnostic chunks', () => {
  describe('toChunk', () => {
    const fn = lib.toChunk;

    it('passes through unprefixed uri', () => {
      expect(fn(foo, {})).to.eql({ [foo]: {} });
    });

    it('removes prefix from uri', () => {
      expect(fn(fullFoo, {})).to.eql({ [foo]: {} });
    });

    it('removes prefix from string data', () => {
      // this happens when bootstrapping uris
      expect(fn(fullFoo, prefix + '/_uris/foo')).to.eql({ [foo]: '/_uris/foo' });
    });

    it('removes prefix from data', () => {
      expect(fn(fullFoo, { a: 'b', c: ['d'], e: { f: 'g' }, h: [1], i: 0})).to.eql({ [foo]: { a: 'b', c: ['d'], e: { f: 'g' }, h: [1], i: 0}});
    });

    it('removes prefix from component lists in data', () => {
      expect(fn(fullFoo, { a: [{ _ref: fullBar }]})).to.eql({ [foo]: { a: [{ _ref: bar }]}});
    });

    it('removes prefix from component props in data', () => {
      expect(fn(fullFoo, { a: { _ref: fullBar }})).to.eql({ [foo]: { a: { _ref: bar }}});
    });

    it('removes prefix from props with string refs', () => {
      // this happens when bootstrapping pages' layout property
      expect(fn(fullFoo, { layout: prefix + '/_components/foo'})).to.eql({ [foo]: { layout: foo } });
    });
  });

  describe('fromChunk', () => {
    const fn = lib.fromChunk;

    it('adds prefix to uri', () => {
      expect(fn(prefix, { [foo]: {} })).to.eql({ [fullFoo]: {} });
    });

    it('adds prefix to layout ref', () => {
      expect(fn(prefix, { [foo]: { layout: '/_components/layout' } })).to.eql({ [fullFoo]: { layout: `${prefix}/_components/layout` } });
    });

    it('adds prefix to customUrl', () => {
      expect(fn(prefix, { [foo]: { customUrl: '/calendar' } })).to.eql({ [fullFoo]: { customUrl: `${prefix}/calendar` } });
    });

    it('adds prefix to data', () => {
      expect(fn(prefix, { [foo]: { a: 'b', c: ['d'], e: { f: 'g' } }})).to.eql({ [fullFoo]: { a: 'b', c: ['d'], e: { f: 'g' } }});
    });

    it('adds prefix to component lists in data', () => {
      expect(fn(prefix, { [foo]: { a: [{ _ref: bar }]} })).to.eql({ [fullFoo]: { a: [{ _ref: fullBar }]}});
    });

    it('adds prefix to component props in data', () => {
      expect(fn(prefix, { [foo]: { a: { _ref: bar }} })).to.eql({ [fullFoo]: { a: { _ref: fullBar }}});
    });

    it('adds correct prefix to base64-encoded /_uris', () => {
      expect(fn(prefix, { '/_uris/foo': '/_pages/bar' })).to.eql({ 'domain.com/_uris/ZG9tYWluLmNvbWZvbw==': 'domain.com/_pages/bar' });
    });
  });

  describe('parseObject', () => {
    const fn = lib.parseObject;

    it('returns empty stream if no props', (done) => {
      fn({}).collect().toCallback((err, data) => {
        expect(data).to.eql([]);
        done(err);
      });
    });

    it('parses uris', (done) => {
      fn({ uris: { '/archive': '/_pages/archive' }}).collect().toCallback((err, data) => {
        expect(data).to.eql([{ '/_uris/archive': '/_pages/archive' }]);
        done(err);
      });
    });

    it('parses pages', (done) => {
      fn({ pages: {
        '/index': {
          layout: '/_components/layout/instances/index',
          main: ['/_components/foo/instances/bar']
        },
        '/archive': {
          layout: '/_components/layout/instances/index',
          main: ['/_components/foo/instances/baz']
        },
        calendar: {
          url: '/foo',
          layout: '/_components/layout/instances/index',
          main: ['/_components/foo/instances/baz']
        }
      }}).collect().toCallback((err, data) => {
        expect(data).to.eql([{
          '/_pages/index': {
            layout: '/_components/layout/instances/index',
            main: ['/_components/foo/instances/bar']
          }
        }, {
          '/_pages/archive': {
            layout: '/_components/layout/instances/index',
            main: ['/_components/foo/instances/baz']
          }
        }, {
          '/_pages/calendar': {
            customUrl: '/foo',
            layout: '/_components/layout/instances/index',
            main: ['/_components/foo/instances/baz']
          }
        }]);
        done(err);
      });
    });

    it('parses lists', (done) => {
      fn({ lists: { a: ['b', 'c'] }}).collect().toCallback((err, data) => {
        expect(data).to.eql([{ '/_lists/a': ['b', 'c'] }]);
        done(err);
      });
    });

    it('parses users', (done) => {
      fn({ users: [{ username: 'foo', provider: 'bar' }]}).collect().toCallback((err, data) => {
        expect(data).to.eql([{ '/_users/Zm9vQGJhcg==': { username: 'foo', provider: 'bar' }}]);
        done(err);
      });
    });

    it('parses empty component defaults', (done) => {
      fn({ components: { foo: {} }}).collect().toCallback((err, data) => {
        expect(data).to.eql([]);
        done(err);
      });
    });

    it('parses component defaults', (done) => {
      fn({ components: { foo: { a: 'b' } }}).collect().toCallback((err, data) => {
        expect(data).to.eql([{ '/_components/foo': { a: 'b' }}]);
        done(err);
      });
    });

    it('parses empty component instances', (done) => {
      fn({
        components: {
          foo: {
            instances: {}
          }
        }
      }).collect().toCallback((err, data) => {
        expect(data).to.eql([]);
        done(err);
      });
    });

    it('parses component instances', (done) => {
      fn({
        components: {
          foo: {
            instances: {
              bar: { a: 'b' }
            }
          }
        }
      }).collect().toCallback((err, data) => {
        expect(data).to.eql([{ '/_components/foo/instances/bar': { a: 'b' }}]);
        done(err);
      });
    });

    it('parses component defaults and instances', (done) => {
      fn({
        components: {
          foo: {
            a: 'b',
            instances: {
              bar: { c: 'd' }
            }
          }
        }
      }).collect().toCallback((err, data) => {
        expect(data).to.eql([{ '/_components/foo': { a: 'b' }}, { '/_components/foo/instances/bar': { c: 'd' }}]);
        done(err);
      });
    });
  });

  describe('validate', () => {
    const fn = lib.validate;

    it('throws error on non-objects', () => expect(() => fn('abc')).to.throw(Error));

    it('throws error on wrong sized object', () => expect(() => fn({})).to.throw(Error));

    it('throws error on weird uris', () => expect(() => fn({ '/gizmos/foo': {} })).to.throw(Error));

    it('throws error on full urls', () => expect(() => fn({ 'domain.com/_components/foo': {} })).to.throw(Error));

    it('passes through valid chunks', () => expect(fn({ '/_components/foo': {} })).to.eql({ '/_components/foo': {} }));
  });

  describe('replacePrefixes', () => {
    const fn = lib.replacePrefixes,
      prefixUrl = `http://${prefix}`;

    it('throws error if not object or string', (done) => {
      fn(prefixUrl)({ url: 'foo', data: 1 }).collect().toCallback((err) => {
        expect(err.message).to.eql('Cannot replace prefixes in data for foo');
        done();
      });
    });

    it('replaces prefixes in object', (done) => {
      fn(prefixUrl)({ url: 'someurl/_components/foo', data: { a: 'b' }}).collect().toCallback((err, data) => {
        expect(data).to.eql([{ url: prefixUrl + '/_components/foo', data: JSON.stringify({ a: 'b' }) }]);
        done(err);
      });
    });

    it('replaces prefixes in stringified json', (done) => {
      fn(prefixUrl)({ url: 'someurl.com/_components/foo', data: JSON.stringify({
        a: 'b',
        c: {
          _ref: 'someurl.com/_components/bar',
          d: 'e'
        },
        f: [{
          _ref: 'someurl.com/_components/baz',
          g: 'h'
        }]
      })}).collect().toCallback((err, data) => {
        expect(data).to.eql([{ url: prefixUrl + '/_components/foo', data: JSON.stringify({
          a: 'b',
          c: {
            _ref: prefix + '/_components/bar',
            d: 'e'
          },
          f: [{
            _ref: prefix + '/_components/baz',
            g: 'h'
          }]
        })}]);
        done(err);
      });
    });
  });

  // we don't need many tests for this, since the deep-reduce and normalize-component libraries are well-tested
  describe('parseDeepObject', () => {
    const fn = lib.parseDeepObject;

    it('returns a stream of normalized data', (done) => {
      fn({ url: 'http://domain.com/_components/foo', data: JSON.stringify({ a: 'b' })}).collect().toCallback((err, data) => {
        expect(data).to.eql([{ '/_components/foo': { a: 'b' }}]);
        done(err);
      });
    });

    it('handles non-stringified pages', (done) => {
      fn({ url: 'http://domain.com/_pages/foo', data: { a: 'b' }}).collect().toCallback((err, data) => {
        expect(data).to.eql([{ '/_pages/foo': { a: 'b' }}]);
        done(err);
      });
    });
  });
});

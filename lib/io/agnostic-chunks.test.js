const lib = require('./agnostic-chunks'),
  prefix = 'domain.com',
  foo = '/components/foo',
  bar = '/components/bar',
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
      expect(fn(fullFoo, prefix + '/uris/foo')).to.eql({ [foo]: '/uris/foo' });
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
      expect(fn(fullFoo, { layout: prefix + '/components/foo'})).to.eql({ [foo]: { layout: foo } });
    });
  });

  describe('fromChunk', () => {
    const fn = lib.fromChunk;

    it('adds prefix to uri', () => {
      expect(fn(prefix, { [foo]: {} })).to.eql({ [fullFoo]: {} });
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
  });

  describe('parseObject', () => {
    const fn = lib.parseObject;

    it('returns empty object if no props', () => expect(fn({})).to.eql({}));

    it('parses uris', () => expect(fn({ uris: { '/archive': '/pages/archive' }})).to.eql({ '/uris/archive': '/pages/archive' }));

    it('parses pages', () => expect(fn({ pages: {
      '/index': {
        layout: '/components/layout/instances/index',
        main: ['/components/foo/instances/bar']
      },
      '/archive': {
        layout: '/components/layout/instances/index',
        main: ['/components/foo/instances/baz']
      }
    }})).to.eql({
      '/pages/index': {
        layout: '/components/layout/instances/index',
        main: ['/components/foo/instances/bar']
      },
      '/pages/archive': {
        layout: '/components/layout/instances/index',
        main: ['/components/foo/instances/baz']
      }
    }));

    it('parses lists', () => expect(fn({ lists: { a: ['b', 'c'] }})).to.eql({ '/lists/a': ['b', 'c'] }));

    it('parses users', () => expect(fn({ users: [{ username: 'foo', provider: 'bar' }]})).to.eql({ '/users/Zm9vQGJhcg==': { username: 'foo', provider: 'bar' }}));

    it('parses empty component defaults', () => expect(fn({ components: { foo: {} }})).to.eql({}));
    it('parses component defaults', () => expect(fn({ components: { foo: { a: 'b' } }})).to.eql({ '/components/foo': { a: 'b' }}));
    it('parses empty component instances', () => expect(fn({ components: { foo: {
      a: 'b',
      instances: {}
    } }})).to.eql({ '/components/foo': { a: 'b' }}));
    it('parses component instances', () => expect(fn({ components: { foo: {
      instances: {
        bar: { a: 'b' }
      }
    }}})).to.eql({ '/components/foo/instances/bar': { a: 'b' }}));
  });
});

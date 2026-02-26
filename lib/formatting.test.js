'use strict';
const lib = require('./formatting');

describe('formatting', () => {
  let bootstrapComponents, bootstrapLayouts, bootstrapPages, bootstrapUsers, bootstrapUserError, bootstrapArbitrary,
    componentDispatch, layoutDispatch, pageDispatch, userDispatch, arbitraryDispatch;

  beforeEach(() => {
    bootstrapComponents = {
      _components: {
        article: {
          title: 'Empty',
          content: [{
            _ref: '/_components/paragraph'
          }],
          instances: {
            foo: {
              title: 'My Article',
              content: [{
                _ref: '/_components/paragraph/instances/bar'
              }]
            }
          }
        },
        paragraph: {
          text: 'empty',
          instances: {
            bar: {
              text: 'lorem ipsum'
            }
          }
        },
        image: {
          url: 'domain.com/image'
        }
      }
    };
    bootstrapLayouts = {
      _layouts: {
        index: {
          instances: {
            foo: {
              head: [{
                _ref: '/_components/meta-title/instances/bar'
              }],
              main: 'main',
              meta: { title: 'Lorem Ipsum Layout' }
            }
          }
        },
        article: {
          head: [{
            _ref: '/_components/meta-title'
          }],
          main: 'main'
        },
        tags: {
          instances: {
            first: {
              main: 'main'
            }
          }
        }
      },
      _components: {
        'meta-title': {
          text: 'empty',
          instances: {
            bar: {
              text: 'lorem ipsum'
            }
          }
        }
      }
    };
    bootstrapPages = {
      _pages: {
        foo: {
          layout: '/_components/layout/instances/bar',
          main: ['/_components/foo/instances/bar'],
          meta: { title: 'Foo' }
        },
        '/bar': { // it deals with slahes
          layout: '/_components/layout/instances/bar',
          main: ['/_components/foo/instances/bar'],
          url: 'http://google.com' // and legacy urls
        }
      }
    };
    bootstrapUsers = {
      _users: [{
        username: 'foo',
        provider: 'google',
        auth: 'admin'
      }, {
        username: 'nobody',
        provider: 'google',
        auth: 'write'
      }]
    };
    bootstrapUserError = {
      _users: [{
        username: 'foo', // no provider
        auth: 'admin'
      }, {
        username: 'nobody',
        provider: 'google' // no auth
      }]
    };
    bootstrapArbitrary = {
      _lists: {
        a: [1, 2, 3]
      },
      _uris: {
        '/': '/_pages/index'
      }
    };
    componentDispatch = [{
      '/_components/article': {
        title: 'Empty',
        content: [{
          _ref: '/_components/paragraph',
          text: 'empty'
        }]
      }
    }, {
      '/_components/article/instances/foo': {
        title: 'My Article',
        content: [{
          _ref: '/_components/paragraph/instances/bar',
          text: 'lorem ipsum'
        }]
      }
    }, {
      '/_components/image': {
        url: 'domain.com/image'
      }
    }];
    layoutDispatch = [{
      '/_layouts/index/instances/foo': {
        head: [{
          _ref: '/_components/meta-title/instances/bar',
          text: 'lorem ipsum'
        }],
        main: 'main'
      }
    }, {
      '/_layouts/index/instances/foo/meta': { title: 'Lorem Ipsum Layout' }
    }, {
      '/_layouts/article': {
        head: [{
          _ref: '/_components/meta-title',
          text: 'empty'
        }],
        main: 'main'
      }
    }, {
      '/_layouts/tags/instances/first': {
        main: 'main'
      }
    }];
    pageDispatch = [{
      '/_pages/foo': {
        layout: '/_components/layout/instances/bar',
        main: ['/_components/foo/instances/bar']
      }
    }, {
      '/_pages/foo/meta': { title: 'Foo' }
    }, {
      '/_pages/bar': {
        layout: '/_components/layout/instances/bar',
        main: ['/_components/foo/instances/bar'],
        customUrl: 'http://google.com'
      }
    }];
    userDispatch = [{
      '/_users/Zm9vQGdvb2dsZQ==': {
        username: 'foo',
        provider: 'google',
        auth: 'admin'
      }
    }, {
      '/_users/bm9ib2R5QGdvb2dsZQ==': {
        username: 'nobody',
        provider: 'google',
        auth: 'write'
      }
    }];
    arbitraryDispatch = [{
      '/_lists/a': [1, 2, 3]
    }, {
      '/_uris/': '/_pages/index'
    }];
  });

  describe('toDispatch', () => {
    it('passes through empty root properties', () => {
      var res = lib.toDispatch([{ _components: {}, _layouts: {}, _pages: {}, _uris: {}, _users: [] }]);

      expect(res).toEqual([]);
    });

    it('converts bootstrapped components to dispatch', () => {
      var res = lib.toDispatch([bootstrapComponents]);

      expect(res).toEqual(componentDispatch);
    });

    it('converts bootstrapped layouts to dispatch', () => {
      var res = lib.toDispatch([bootstrapLayouts]);

      expect(res).toEqual(layoutDispatch);
    });

    it('converts bootstrapped pages to dispatch', () => {
      var res = lib.toDispatch([bootstrapPages]);

      expect(res).toEqual(pageDispatch);
    });

    it('converts bootstrapped users to dispatch', () => {
      var res = lib.toDispatch([bootstrapUsers]);

      expect(res).toEqual(userDispatch);
    });

    it('errors if users are missing properties', () => {
      expect(() => lib.toDispatch([bootstrapUserError])).toThrow('Cannot bootstrap users without username, provider, and auth level');
    });

    it('converts bootstrapped arbitrary data to dispatch', () => {
      var res = lib.toDispatch([bootstrapArbitrary]);

      expect(res).toEqual(arbitraryDispatch);
    });
  });

  describe('toBootstrap', () => {
    it('converts deep component dispatch to bootstrap', () => {
      var res = lib.toBootstrap(componentDispatch);

      expect(res).toEqual(bootstrapComponents);
    });

    it('converts deep layout dispatch to bootstrap', () => {
      var res = lib.toBootstrap(layoutDispatch);

      expect(res).toEqual(bootstrapLayouts);
    });

    it('converts page dispatch to bootstrap (legacy)', () => {
      var res = lib.toBootstrap([{
        '/_pages/foo': { // convert slash
          layout: '/_components/layout/instances/bar',
          main: ['/_components/foo/instances/bar']
        }
      }, {
        '/_pages/bar': {
          layout: '/_components/layout/instances/bar',
          main: ['/_components/foo/instances/bar'],
          url: 'http://google.com'
        }
      }]);

      expect(res).toEqual({
        _pages: {
          foo: { // adds slash
            layout: '/_components/layout/instances/bar',
            main: ['/_components/foo/instances/bar']
          },
          bar: {
            layout: '/_components/layout/instances/bar',
            main: ['/_components/foo/instances/bar'],
            customUrl: 'http://google.com' // deals with url
          }
        }
      });
    });

    it('converts page dispatch to bootstrap', () => {
      var res = lib.toBootstrap([{
        '/_pages/foo': { // convert slash
          layout: '/_layouts/layout/instances/bar',
          main: ['/_components/foo/instances/bar']
        }
      }, {
        '/_pages/bar': {
          layout: '/_layouts/layout/instances/bar',
          main: ['/_components/foo/instances/bar'],
          url: 'http://google.com'
        }
      }, {
        '/_pages/foo/meta': { title: 'Foo' }
      }]);

      expect(res).toEqual({
        _pages: {
          foo: { // adds slash
            layout: '/_layouts/layout/instances/bar',
            main: ['/_components/foo/instances/bar'],
            meta: { title: 'Foo' }
          },
          bar: {
            layout: '/_layouts/layout/instances/bar',
            main: ['/_components/foo/instances/bar'],
            customUrl: 'http://google.com' // deals with url
          }
        }
      });
    });

    it('converts user dispatch to bootstrap', () => {
      var res = lib.toBootstrap(userDispatch);

      expect(res).toEqual({
        _users: [{
          username: 'foo',
          provider: 'google',
          auth: 'admin'
        }, {
          username: 'nobody',
          provider: 'google',
          auth: 'write'
        }]
      });
    });

    it('converts arbitrary data dispatch to bootstrap', () => {
      var res = lib.toBootstrap(arbitraryDispatch);

      expect(res).toEqual(bootstrapArbitrary);
    });

    it('converts mixed dispatches to bootstrap', () => {
      var res = lib.toBootstrap([{
        '/_components/a': { child: { _ref: '/_components/b', a: 'b' } }
      }, {
        '/_layouts/l/instances/i': { head: 'head' }
      }, {
        '/_layouts/l/instances/i/meta': { title: 'L'}
      }, {
        '/_users/abc': { username: 'a', provider: 'b', auth: 'admin' }
      }, {
        '/_users/def': { username: 'd', provider: 'e', auth: 'admin' }
      }]);

      expect(res).toEqual({
        _components: {
          a: { child: { _ref: '/_components/b' } },
          b: { a: 'b' }
        },
        _layouts: {
          l: {
            instances: {
              i: {
                head: 'head',
                meta: { title: 'L' }
              }
            }
          }
        },
        _users: [{
          username: 'a',
          provider: 'b',
          auth: 'admin'
        }, {
          username: 'd',
          provider: 'e',
          auth: 'admin'
        }]
      });
    });
  });
});

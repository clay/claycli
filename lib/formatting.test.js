'use strict';
const h = require('highland'),
  lib = require('./formatting');

describe('formatting', () => {
  let bootstrapComponents, bootstrapPages, bootstrapUsers, bootstrapUserError, bootstrapArbitrary,
    componentDispatch, pageDispatch, userDispatch, arbitraryDispatch;

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
    bootstrapPages = {
      _pages: {
        foo: {
          layout: '/_components/layout/instances/bar',
          main: ['/_components/foo/instances/bar']
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
    pageDispatch = [{
      '/_pages/foo': {
        layout: '/_components/layout/instances/bar',
        main: ['/_components/foo/instances/bar']
      }
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
      return lib.toDispatch(h([{ _components: {}, _pages: {}, _uris: {}, _users: [] }])).collect().toPromise(Promise).then((res) => {
        expect(res).toEqual([]);
      });
    });

    it('converts bootstrapped components to dispatch', () => {
      return lib.toDispatch(h([bootstrapComponents])).collect().toPromise(Promise).then((res) => {
        expect(res).toEqual(componentDispatch);
      });
    });

    it('converts bootstrapped pages to dispatch', () => {
      return lib.toDispatch(h([bootstrapPages])).collect().toPromise(Promise).then((res) => {
        expect(res).toEqual(pageDispatch);
      });
    });

    it('converts bootstrapped users to dispatch', () => {
      return lib.toDispatch(h([bootstrapUsers])).collect().toPromise(Promise).then((res) => {
        expect(res).toEqual(userDispatch);
      });
    });

    it('errors if users are missing properties', () => {
      return lib.toDispatch(h([bootstrapUserError])).collect().toPromise(Promise).catch((e) => {
        expect(e.message).toBe('Cannot bootstrap users without username, provider, and auth level');
      });
    });

    it('converts bootstrapped arbitrary data to dispatch', () => {
      return lib.toDispatch(h([bootstrapArbitrary])).collect().toPromise(Promise).then((res) => {
        expect(res).toEqual(arbitraryDispatch);
      });
    });
  });

  describe('toBootstrap', () => {
    it('converts deep component dispatch to bootstrap', () => {
      return lib.toBootstrap(h(componentDispatch)).toPromise(Promise).then((res) => {
        expect(res).toEqual(bootstrapComponents);
      });
    });

    it('converts page dispatch to bootstrap', () => {
      return lib.toBootstrap(h([{
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
      }])).toPromise(Promise).then((res) => {
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
    });

    it('converts user dispatch to bootstrap', () => {
      return lib.toBootstrap(h(userDispatch)).toPromise(Promise).then((res) => {
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
    });

    it('converts arbitrary data dispatch to bootstrap', () => {
      return lib.toBootstrap(h(arbitraryDispatch)).toPromise(Promise).then((res) => {
        expect(res).toEqual(bootstrapArbitrary);
      });
    });

    it('converts mixed dispatches to bootstrap', () => {
      return lib.toBootstrap(h([{
        '/_components/a': { child: { _ref: '/_components/b', a: 'b' } }
      }, {
        '/_users/abc': { username: 'a', provider: 'b', auth: 'admin' }
      }, {
        '/_users/def': { username: 'd', provider: 'e', auth: 'admin' }
      }])).toPromise(Promise).then((res) => {
        expect(res).toEqual({
          _components: {
            a: { child: { _ref: '/_components/b' } },
            b: { a: 'b' }
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
});

'use strict';
const lib = require('./formatting'),
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
  },
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
  },
  bootstrapUsers = {
    _users: [{
      username: 'foo',
      provider: 'google',
      auth: 'admin'
    }, {
      username: 'nobody',
      provider: 'google' // no auth
    }]
  },
  bootstrapArbitrary = {
    _lists: {
      a: [1, 2, 3]
    },
    _uris: {
      '/': '/_pages/index'
    }
  },
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
  }],
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
  }],
  userDispatch = [{
    '/_users/Zm9vQGdvb2dsZQ==': {
      username: 'foo',
      provider: 'google',
      auth: 'admin'
    }
  }],
  arbitraryDispatch = [{
    '/_lists/a': [1, 2, 3]
  }, {
    '/_uris/': '/_pages/index'
  }];

describe('formatting', () => {
  describe('toDispatch', () => {
    it('passes through empty root properties', () => {
      return lib.toDispatch(h([{ _components: {}, _pages: {}, _uris: {}, _users: [] }])).collect().toPromise().then((res) => {
        expect(res).toEqual([]);
      });
    });

    it('converts bootstrapped components to dispatch', () => {
      return lib.toDispatch(h([bootstrapComponents])).collect().toPromise().then((res) => {
        expect(res).toEqual(componentDispatch);
      });
    });

    it('converts bootstrapped pages to dispatch', () => {
      return lib.toDispatch(h([bootstrapPages])).collect().toPromise().then((res) => {
        expect(res).toEqual(pageDispatch);
      });
    });

    it('converts bootstrapped users to dispatch', () => {
      return lib.toDispatch(h([bootstrapUsers])).collect().toPromise().then((res) => {
        expect(res).toEqual(userDispatch);
      });
    });

    it('converts bootstrapped arbitrary data to dispatch', () => {
      return lib.toDispatch(h([bootstrapArbitrary])).collect().toPromise().then((res) => {
        expect(res).toEqual(arbitraryDispatch);
      });
    });
  });

  describe('toBootstrap', () => {
    it.skip('converts dispatch to bootstrap', () => {
      return lib.toBootstrap(h(dispatches)).collect().toPromise().then((res) => {
        expect(res).toEqual(bootstrapComponents);
      });
    });
  });
});

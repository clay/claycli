'use strict';
const lib = require('./formatting'),
  bootstrap = {
    _components: {
      article: {
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
        instances: {
          bar: {
            text: 'lorem ipsum'
          }
        }
      }
    }
  },
  dispatch = {
    '/_components/article/instances/foo': {
      title: 'My Article',
      content: [{
        _ref: '/_components/paragraph/instances/bar',
        text: 'lorem ipsum'
      }]
    }
  };

describe('formatting', () => {
  describe('toDispatch', () => {
    it.only('converts bootstrap to dispatch', () => {
      return lib.toDispatch(h([bootstrap])).toPromise().then((res) => {
        expect(res).toEqual(dispatch);
      });
    });
  });

  describe('toBootstrap', () => {
    it.skip('converts dispatch to bootstrap', () => {
      return lib.toBootstrap(h([dispatch])).toPromise().then((res) => {
        expect(res).toEqual(bootstrap);
      });
    });
  });
});

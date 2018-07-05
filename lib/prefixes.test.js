'use strict';
const lib = require('./prefixes'),
  prefix = 'domain.com';

describe('prefixes', () => {
  describe('add', () => {
    it('handles url prefix', () => {
      return lib.add({
        '/_components/foo/instances/bar': { a: 'b' }
      }, `http://${prefix}`).toPromise(Promise).then((res) => {
        expect(res).toEqual({
          'domain.com/_components/foo/instances/bar': { a: 'b' }
        });
      });
    });

    it('adds prefix to _uris', () => {
      return lib.add({
        '/_uris/foo': '/_pages/bar'
      }, prefix).toPromise(Promise).then((res) => {
        expect(res).toEqual({
          'domain.com/_uris/ZG9tYWluLmNvbS9mb28=': 'domain.com/_pages/bar'
        });
      });
    });

    it('adds prefix to root _uri', () => {
      return lib.add({
        '/_uris/': '/_pages/index'
      }, prefix).toPromise(Promise).then((res) => {
        expect(res).toEqual({
          'domain.com/_uris/ZG9tYWluLmNvbS8=': 'domain.com/_pages/index'
        });
      });
    });

    it('adds prefix to key', () => {
      return lib.add({
        '/_components/foo/instances/bar': { a: 'b' }
      }, prefix).toPromise(Promise).then((res) => {
        expect(res).toEqual({
          'domain.com/_components/foo/instances/bar': { a: 'b' }
        });
      });
    });

    it('adds prefix to child components', () => {
      return lib.add({
        '/_components/foo/instances/bar': { a: { _ref: '/_components/bar/instances/baz', c: 'd' } }
      }, prefix).toPromise(Promise).then((res) => {
        expect(res).toEqual({
          'domain.com/_components/foo/instances/bar': { a: { _ref: 'domain.com/_components/bar/instances/baz', c: 'd' } }
        });
      });
    });

    it('adds prefix to pages', () => {
      return lib.add({
        '/_pages/abc': { main: ['/_components/foo/instances/bar'] }
      }, prefix).toPromise(Promise).then((res) => {
        expect(res).toEqual({
          'domain.com/_pages/abc': { main: ['domain.com/_components/foo/instances/bar'] }
        });
      });
    });

    it('adds prefix to customUrl', () => {
      return lib.add({
        '/_pages/abc': { customUrl: '/' }
      }, `http://${prefix}`).toPromise(Promise).then((res) => {
        expect(res).toEqual({
          'domain.com/_pages/abc': { customUrl: 'http://domain.com/' }
        });
      });
    });

    it('adds prefix to ssl customUrl', () => {
      return lib.add({
        '/_pages/abc': { customUrl: '/' }
      }, `https://${prefix}`).toPromise(Promise).then((res) => {
        expect(res).toEqual({
          'domain.com/_pages/abc': { customUrl: 'https://domain.com/' }
        });
      });
    });

    it('does not mess up non-clay data', () => {
      return lib.add({
        '/_components/paragraph/instances/example': { text: 'Sanjay Srivastava <a href=\"http://pages.uoregon.edu/sanjay/bigfive.html#whatisit\" target=\"_blank\">explains on his website</a>, each' }
      }, prefix).toPromise(Promise).then((res) => {
        expect(res).toEqual({
          'domain.com/_components/paragraph/instances/example': { text: 'Sanjay Srivastava <a href=\"http://pages.uoregon.edu/sanjay/bigfive.html#whatisit\" target=\"_blank\">explains on his website</a>, each' }
        });
      });
    });
  });

  describe('remove', () => {
    it('handles url prefix', () => {
      return lib.remove({
        'domain.com/_components/foo/instances/bar': { a: 'b' }
      }, `http://${prefix}`).toPromise(Promise).then((res) => {
        expect(res).toEqual({
          '/_components/foo/instances/bar': { a: 'b' }
        });
      });
    });

    it('removes prefix from key', () => {
      return lib.remove({
        'domain.com/_components/foo/instances/bar': { a: 'b' }
      }, prefix).toPromise(Promise).then((res) => {
        expect(res).toEqual({
          '/_components/foo/instances/bar': { a: 'b' }
        });
      });
    });

    it('removes prefix from _uris', () => {
      return lib.remove({
        'domain.com/_uris/ZG9tYWluLmNvbS9mb28=': 'domain.com/_pages/bar'
      }, prefix).toPromise(Promise).then((res) => {
        expect(res).toEqual({
          '/_uris/foo': '/_pages/bar'
        });
      });
    });

    it('removes prefix from root _uri', () => {
      return lib.remove({
        'domain.com/_uris/ZG9tYWluLmNvbS8=': 'domain.com/_pages/index'
      }, prefix).toPromise(Promise).then((res) => {
        expect(res).toEqual({
          '/_uris/': '/_pages/index'
        });
      });
    });

    it('removes prefix from child components', () => {
      return lib.remove({
        'domain.com/_components/foo/instances/bar': { a: { _ref: 'domain.com/_components/bar/instances/baz', c: 'd' } }
      }, prefix).toPromise(Promise).then((res) => {
        expect(res).toEqual({
          '/_components/foo/instances/bar': { a: { _ref: '/_components/bar/instances/baz', c: 'd' } }
        });
      });
    });

    it('removes prefix from pages', () => {
      return lib.remove({
        'domain.com/_pages/abc': { main: ['domain.com/_components/foo/instances/bar'] }
      }, prefix).toPromise(Promise).then((res) => {
        expect(res).toEqual({
          '/_pages/abc': { main: ['/_components/foo/instances/bar'] }
        });
      });
    });

    it('removes prefix from customUrl', () => {
      return lib.remove({
        'domain.com/_pages/abc': { customUrl: 'http://domain.com/' }
      }, `http://${prefix}`).toPromise(Promise).then((res) => {
        expect(res).toEqual({
          '/_pages/abc': { customUrl: '/' }
        });
      });
    });

    it('removes prefix from ssl customUrl', () => {
      return lib.remove({
        'domain.com/_pages/abc': { customUrl: 'https://domain.com/' }
      }, `https://${prefix}`).toPromise(Promise).then((res) => {
        expect(res).toEqual({
          '/_pages/abc': { customUrl: '/' }
        });
      });
    });

    it('does not mess up non-clay data', () => {
      return lib.remove({
        'domain.com/_components/paragraph/instances/example': { text: 'Sanjay Srivastava <a href=\"http://pages.uoregon.edu/sanjay/bigfive.html#whatisit\" target=\"_blank\">explains on his website</a>, each' }
      }, prefix).toPromise(Promise).then((res) => {
        expect(res).toEqual({
          '/_components/paragraph/instances/example': { text: 'Sanjay Srivastava <a href=\"http://pages.uoregon.edu/sanjay/bigfive.html#whatisit\" target=\"_blank\">explains on his website</a>, each' }
        });
      });
    });
  });

  describe('getFromUrl', () => {
    it('throws error when not given an api route', () => {
      expect(() => lib.getFromUrl('domain.com/foo')).toThrow('Unable to find site prefix for domain.com/foo');
    });

    it('gets prefix for components', () => {
      expect(lib.getFromUrl('domain.com/_components/foo')).toBe('domain.com');
      expect(lib.getFromUrl('domain.com/somepath/_components/foo')).toBe('domain.com/somepath');
    });

    it('gets prefix for pages', () => {
      expect(lib.getFromUrl('domain.com/_pages/foo')).toBe('domain.com');
      expect(lib.getFromUrl('domain.com/somepath/_pages/foo')).toBe('domain.com/somepath');
    });

    it('gets prefix for users', () => {
      expect(lib.getFromUrl('domain.com/_users/foo')).toBe('domain.com');
      expect(lib.getFromUrl('domain.com/somepath/_users/foo')).toBe('domain.com/somepath');
    });

    it('gets prefix for uris', () => {
      expect(lib.getFromUrl('domain.com/_uris/foo')).toBe('domain.com');
      expect(lib.getFromUrl('domain.com/somepath/_uris/foo')).toBe('domain.com/somepath');
    });

    it('gets prefix for lists', () => {
      expect(lib.getFromUrl('domain.com/_lists/foo')).toBe('domain.com');
      expect(lib.getFromUrl('domain.com/somepath/_lists/foo')).toBe('domain.com/somepath');
    });
  });

  describe('uriToUrl', () => {
    it('converts component uri', () => {
      expect(lib.uriToUrl('http://domain.com', 'domain.com/_components/foo/instances/bar')).toBe('http://domain.com/_components/foo/instances/bar');
    });
  });

  describe('urlToUri', () => {
    it('converts component uri', () => {
      expect(lib.urlToUri('http://domain.com/_components/foo/instances/bar')).toBe('domain.com/_components/foo/instances/bar');
    });

    it('converts bare domain', () => {
      expect(lib.urlToUri('http://domain.com')).toBe('domain.com');
    });

    it('removes extensions from path', () => {
      expect(lib.urlToUri('http://domain.com/_components/foo.json')).toBe('domain.com/_components/foo');
    });
  });

  describe('getExt', () => {
    it('returns null if no prefix', () => {
      expect(lib.getExt('http://domain.com/_components/foo')).toBe(null);
    });

    it('returns extension', () => {
      expect(lib.getExt('http://domain.com/_components/foo.html')).toBe('.html');
    });
  });
});

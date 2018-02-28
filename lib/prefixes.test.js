'use strict';
const h = require('highland'),
  lib = require('./prefixes'),
  prefix = 'domain.com';

describe('prefixes', () => {
  describe('add', () => {
    it('adds prefix to key', () => {
      return lib.add(h([{
        '/_components/foo/instances/bar': { a: 'b' }
      }]), prefix).toPromise(Promise).then((res) => {
        expect(res).toEqual({
          'domain.com/_components/foo/instances/bar': { a: 'b' }
        });
      });
    });

    it('adds prefix to child components', () => {
      return lib.add(h([{
        '/_components/foo/instances/bar': { a: { _ref: '/_components/bar/instances/baz', c: 'd' } }
      }]), prefix).toPromise(Promise).then((res) => {
        expect(res).toEqual({
          'domain.com/_components/foo/instances/bar': { a: { _ref: 'domain.com/_components/bar/instances/baz', c: 'd' } }
        });
      });
    });

    it('adds prefix to pages', () => {
      return lib.add(h([{
        '/_pages/abc': { main: ['/_components/foo/instances/bar'] }
      }]), prefix).toPromise(Promise).then((res) => {
        expect(res).toEqual({
          'domain.com/_pages/abc': { main: ['domain.com/_components/foo/instances/bar'] }
        });
      });
    });

    it('does not mess up non-clay data', () => {
      return lib.add(h([{
        '/_components/paragraph/instances/example': { text: 'Sanjay Srivastava <a href=\"http://pages.uoregon.edu/sanjay/bigfive.html#whatisit\" target=\"_blank\">explains on his website</a>, each' }
      }]), prefix).toPromise(Promise).then((res) => {
        expect(res).toEqual({
          'domain.com/_components/paragraph/instances/example': { text: 'Sanjay Srivastava <a href=\"http://pages.uoregon.edu/sanjay/bigfive.html#whatisit\" target=\"_blank\">explains on his website</a>, each' }
        });
      });
    });
  });

  describe('remove', () => {
    it('removes prefix from key', () => {
      return lib.remove(h([{
        'domain.com/_components/foo/instances/bar': { a: 'b' }
      }]), prefix).toPromise(Promise).then((res) => {
        expect(res).toEqual({
          '/_components/foo/instances/bar': { a: 'b' }
        });
      });
    });

    it('removes prefix from child components', () => {
      return lib.remove(h([{
        'domain.com/_components/foo/instances/bar': { a: { _ref: 'domain.com/_components/bar/instances/baz', c: 'd' } }
      }]), prefix).toPromise(Promise).then((res) => {
        expect(res).toEqual({
          '/_components/foo/instances/bar': { a: { _ref: '/_components/bar/instances/baz', c: 'd' } }
        });
      });
    });

    it('removes prefix from pages', () => {
      return lib.remove(h([{
        'domain.com/_pages/abc': { main: ['domain.com/_components/foo/instances/bar'] }
      }]), prefix).toPromise(Promise).then((res) => {
        expect(res).toEqual({
          '/_pages/abc': { main: ['/_components/foo/instances/bar'] }
        });
      });
    });

    it('does not mess up non-clay data', () => {
      return lib.remove(h([{
        'domain.com/_components/paragraph/instances/example': { text: 'Sanjay Srivastava <a href=\"http://pages.uoregon.edu/sanjay/bigfive.html#whatisit\" target=\"_blank\">explains on his website</a>, each' }
      }]), prefix).toPromise(Promise).then((res) => {
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
});

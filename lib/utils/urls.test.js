const lib = require('./urls');

describe('urls', () => {
  describe('urlToUri', () => {
    const fn = lib.urlToUri;

    it('removes protocol and port', () => expect(fn('http://localhost:3001/hi')).to.eql('localhost/hi'));
  });

  describe('getUrlPrefix', () => {
    const fn = lib.getUrlPrefix,
      prefix = 'http://domain.com:3001/path';

    it('parses prefix for components', () => expect(fn(`${prefix}/components/foo`)).to.eql({ prefix, path: '/components/foo' }));
    it('parses prefix for uris', () => expect(fn(`${prefix}/uris/foo`)).to.eql({ prefix, path: '/uris/foo' }));
    it('parses prefix for pages', () => expect(fn(`${prefix}/pages/foo`)).to.eql({ prefix, path: '/pages/foo' }));
    it('parses prefix for lists', () => expect(fn(`${prefix}/lists/foo`)).to.eql({ prefix, path: '/lists/foo' }));
    it('parses prefix for users', () => expect(fn(`${prefix}/users/foo`)).to.eql({ prefix, path: '/users/foo' }));
    it('throws error for unknown type', () => expect(() => fn(`${prefix}/2017/01/some-slug`)).to.throw('Cannot parse url for site prefix!'));
  });

  describe('uriToUrl', () => {
    const fn = lib.uriToUrl,
      prefix = 'http://domain.com:3001/path',
      noPort = 'domain.com/path';

    it('adds prefix to components (passed in)', () => expect(fn(prefix, `${noPort}/components/foo`)).to.eql(`${prefix}/components/foo`));
    it('adds prefix to uris (passed in)', () => expect(fn(prefix, `${noPort}/uris/foo`)).to.eql(`${prefix}/uris/foo`));
    it('adds prefix to pages (passed in)', () => expect(fn(prefix, `${noPort}/pages/foo`)).to.eql(`${prefix}/pages/foo`));
    it('adds prefix to lists (passed in)', () => expect(fn(prefix, `${noPort}/lists/foo`)).to.eql(`${prefix}/lists/foo`));
    it('adds prefix to users (passed in)', () => expect(fn(prefix, `${noPort}/users/foo`)).to.eql(`${prefix}/users/foo`));
    it('uses prefix from uri if none passed in', () => expect(fn(null, `${noPort}/components/bar`)).to.eql(`${noPort}/components/bar`));
  });
});

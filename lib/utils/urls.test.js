'use strict';

const lib = require('./urls');

describe('urls', () => {
  describe('urlToUri', () => {
    const fn = lib.urlToUri;

    it('removes protocol and port', () => expect(fn('http://localhost:3001/hi')).to.eql('localhost/hi'));
    it('removes ending slash for urls with no path', () => expect(fn('http://domain.com')).to.eql('domain.com'));
  });

  describe('getUrlPrefix', () => {
    const fn = lib.getUrlPrefix,
      prefix = 'http://domain.com:3001/path';

    it('parses prefix for components', () => expect(fn(`${prefix}/_components/foo`)).to.eql({ prefix, path: '/_components/foo' }));
    it('parses prefix for uris', () => expect(fn(`${prefix}/_uris/foo`)).to.eql({ prefix, path: '/_uris/foo' }));
    it('parses prefix for pages', () => expect(fn(`${prefix}/_pages/foo`)).to.eql({ prefix, path: '/_pages/foo' }));
    it('parses prefix for lists', () => expect(fn(`${prefix}/_lists/foo`)).to.eql({ prefix, path: '/_lists/foo' }));
    it('parses prefix for users', () => expect(fn(`${prefix}/_users/foo`)).to.eql({ prefix, path: '/_users/foo' }));
    it('throws error for unknown type', () => expect(() => fn(`${prefix}/2017/01/some-slug`)).to.throw('Cannot parse url for site prefix!'));
  });

  describe('uriToUrl', () => {
    const fn = lib.uriToUrl,
      prefix = 'http://domain.com:3001/path',
      noPort = 'domain.com/path';

    it('adds prefix to components (passed in)', () => expect(fn(prefix, `${noPort}/_components/foo`)).to.eql(`${prefix}/_components/foo`));
    it('adds prefix to uris (passed in)', () => expect(fn(prefix, `${noPort}/_uris/foo`)).to.eql(`${prefix}/_uris/foo`));
    it('adds prefix to pages (passed in)', () => expect(fn(prefix, `${noPort}/_pages/foo`)).to.eql(`${prefix}/_pages/foo`));
    it('adds prefix to lists (passed in)', () => expect(fn(prefix, `${noPort}/_lists/foo`)).to.eql(`${prefix}/_lists/foo`));
    it('adds prefix to users (passed in)', () => expect(fn(prefix, `${noPort}/_users/foo`)).to.eql(`${prefix}/_users/foo`));
    it('uses prefix from uri if none passed in', () => expect(fn(null, `${noPort}/_components/bar`)).to.eql(`${noPort}/_components/bar`));
  });
});

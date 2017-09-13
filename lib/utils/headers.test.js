const lib = require('./headers'),
  singleHeaderMock = {
    argv: {
      headers: 'X-Forwarded-Host: some-site.com'
    },
    headersObj: {
      'X-Forwarded-Host': 'some-site.com'
    }
  },
  multipleHeadersMock = {
    argv: {
      headers: [singleHeaderMock.argv.headers].concat(['Custom-Header: some-value'])
    },
    headersObj: Object.assign({'Custom-Header': 'some-value'}, singleHeaderMock.headersObj)
  };

describe('headers', function () {

  describe('getYargHeaders', function () {
    const fn = lib[this.title];

    it('returns empty object if no headers yarg', () =>
      expect(fn({})).to.deep.equal({})
    );

    it('returns headers object for single headers yarg', () =>
      expect(fn(singleHeaderMock.argv)).to.deep.equal(singleHeaderMock.headersObj)
    );

    it('returns headers object for multiple headers yargs', () =>
      expect(fn(multipleHeadersMock.argv)).to.deep.equal(multipleHeadersMock.headersObj)
    );

    it('throws on unknown header format', () =>
      expect(fn.bind(lib, {headers: 'weird-header=unknown-format'})).to.throw(Error)
    );
  });
});

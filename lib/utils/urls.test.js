const lib = require('./urls');

describe('urls', () => {
  describe('urlToUri', () => {
    const fn = lib.urlToUri;

    it('removes protocol and port', () => expect(fn('http://localhost:3001/hi')).to.eql('localhost/hi'));
  });
});

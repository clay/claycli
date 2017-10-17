const importApi = require('./index'),
  fn = require('./import-users'),
  sinon = require('sinon'),
  fetch = require('../../utils/fetch'),
  h = require('highland'),
  clayInput = require('../../io/input-clay'),
  {assertItems} = require('../../../test/test-util'),
  aSite = 'http://a.com',
  bSite = 'http://b.com';

require('../../utils/logger').init();

describe('Import Api: importUsers', function () {
  let sandbox;

  beforeEach(function () {
    sandbox = sinon.sandbox.create();
    sandbox.stub(clayInput, 'streamPageUris');
    sandbox.stub(fetch, 'send');
    sandbox.stub(clayInput, 'streamUserUris');
    sandbox.stub(importApi, 'importUrl');
    importApi.importUrl.withArgs('http://a.com/users/foo').returns(h(['a','b']));
    importApi.importUrl.withArgs('http://a.com/users/bar').returns(h(['c','d']));
  });

  afterEach(function () {
    sandbox.restore();
  });

  it ('calls importUrl with all relevant arguments and options for each list in site', function () {
    const mockOpts = {key: 'foo', concurrency: 1, headers: {foo: 'bar'}};

    clayInput.streamUserUris.withArgs(aSite).returns(h(['a.com/users/foo', 'a.com/users/bar']));
    return fn(aSite, bSite, mockOpts)
      .collect()
      .toPromise(Promise)
      .then((results) => {
        const authorsCall = importApi.importUrl.getCalls()[0],
          pagesCall = importApi.importUrl.getCalls()[1];

        assertItems(results, ['a','b','c','d']);
        expect(authorsCall.args[0]).to.equal('http://a.com/users/foo');
        expect(authorsCall.args[1]).to.equal(bSite);
        expect(authorsCall.args[2]).to.eql(mockOpts);
        expect(pagesCall.args[0]).to.equal('http://a.com/users/bar');
        expect(pagesCall.args[1]).to.equal(bSite);
        expect(pagesCall.args[2]).to.eql(mockOpts);
      });
  });
});

const fn = require('./index').importLists,
  h = require('highland'),
  clayInput = require('../../io/input-clay'),
  importApi = require('./index'),
  {assertItems} = require('../../../test/test-util'),
  aSite = 'http://a.com',
  bSite = 'http://b.com';

require('../../utils/logger').init();

describe('Import API: importLists', function () {
  let sandbox;

  beforeEach(function () {
    sandbox = sinon.sandbox.create();
    sandbox.stub(clayInput, 'streamListUris');
    sandbox.stub(importApi, 'importUrl');
    importApi.importUrl.withArgs('http://a.com/lists/foo').returns(h(['a','b']));
    importApi.importUrl.withArgs('http://a.com/lists/bar').returns(h(['c','d']));
  });

  afterEach(function () {
    sandbox.restore();
  });

  it ('calls importUrl with all relevant arguments and options for each list in site', function () {
    const mockOpts = {key: 'foo', concurrency: 1, headers: {foo: 'bar'}};

    clayInput.streamListUris.withArgs(aSite).returns(h(['a.com/b/lists/foo', 'a.com/lists/bar']));
    return fn(aSite, bSite, mockOpts)
      .collect()
      .toPromise(Promise)
      .then((results) => {
        const authorsCall = importApi.importUrl.getCalls()[0],
          pagesCall = importApi.importUrl.getCalls()[1];

        assertItems(results, ['a','b','c','d']);
        expect(authorsCall.args[0]).to.equal('http://a.com/lists/foo');
        expect(authorsCall.args[1]).to.equal(bSite);
        expect(authorsCall.args[2]).to.eql(mockOpts);
        expect(pagesCall.args[0]).to.equal('http://a.com/lists/bar');
        expect(pagesCall.args[1]).to.equal(bSite);
        expect(pagesCall.args[2]).to.eql(mockOpts);
      });
  });
});

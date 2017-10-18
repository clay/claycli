const importApi = require('./index'),
  fn = importApi.importSite,
  sinon = require('sinon'),
  h = require('highland'),
  aSite = 'http://a.com',
  bSite = 'http://b.com',
  {assertItems} = require('../../../test/test-util');

describe('Import API: importSite', function () {
  let sandbox;

  beforeEach(function () {
    sandbox = sinon.sandbox.create();
    sandbox.stub(importApi, 'importPages');
    sandbox.stub(importApi, 'importLists');
    sandbox.stub(importApi, 'importUris');
    sandbox.stub(importApi, 'importUsers');
    importApi.importPages.returns(h(['a', 'b']));
    importApi.importLists.returns(h(['c', 'd']));
    importApi.importUris.returns(h(['e','f']));
    importApi.importUsers.returns(h(['g','h']));
  });

  afterEach(function () {
    sandbox.restore();
  });

  it ('calls all relevant import fncs, passing all relevant arguments and options and merging results', function () {
    const opts = {limit: 1, offset: 2, concurrency: 3, key: 'foo', sourceKey: 'bar', overwriteLayouts: true, published: true, headers: {foo: 'bar'}};

    return fn(aSite, bSite, opts)
      .collect()
      .toPromise(Promise)
      .then((results) => {
        let pagesCall = importApi.importPages.getCalls()[0],
          listsCall = importApi.importLists.getCalls()[0],
          urisCall = listsCall = importApi.importUris.getCalls()[0],
          usersCall = listsCall = importApi.importUris.getCalls()[0];

        // check pages call
        expect(pagesCall.args[0]).to.equal(aSite);
        expect(pagesCall.args[1]).to.equal(bSite);
        expect(pagesCall.args[2]).to.eql(opts);

        // check lists call
        expect(listsCall.args[0]).to.equal(aSite);
        expect(listsCall.args[1]).to.equal(bSite);
        expect(listsCall.args[2]).to.eql({
          key: 'foo',
          concurrency: 3
        });

        // check uris call
        expect(urisCall.args[0]).to.equal(aSite);
        expect(urisCall.args[1]).to.equal(bSite);
        expect(urisCall.args[2]).to.eql({
          key: 'foo',
          concurrency: 3
        });

        // check users call
        expect(usersCall.args[0]).to.equal(aSite);
        expect(usersCall.args[1]).to.equal(bSite);
        expect(usersCall.args[2]).to.eql({
          key: 'foo',
          concurrency: 3
        });

        assertItems(results, ['a','b','c','d','e','f','g','h']);
      });
  });
});

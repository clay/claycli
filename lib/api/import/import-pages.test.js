const fn = require('./import-pages'),
  sinon = require('sinon'),
  fetch = require('../../utils/fetch'),
  h = require('highland'),
  clayInput = require('../../io/input-clay'),
  _ = require('lodash'),
  importApi = require('./index'),
  {
    matchReq,
    mockReq,
    assertStream
  } = require('../../../test/test-util'),
  aSite = 'http://a.com',
  bSite = 'http://b.com',
  aCmpt1Uri = 'a.com/components/foo/instances/1',
  aCmpt1UrlJson = `http://${aCmpt1Uri}.json`,
  aPage1 = 'http://a.com/pages/1',
  aPage2 = 'http://a.com/pages/2',
  bPage1 = 'http://b.com/pages/1',
  bPage2 = 'http://b.com/pages/2',
  bCmpt1Uri = 'b.com/components/foo/instances/1',
  bCmpt1Url = `http://${bCmpt1Uri}`;

require('../../utils/logger').init();

function mockPagesIndex(...pagePublishStates) {
  const results = pagePublishStates
    .reduce((agg, curr, index) => {
      agg.push(`http://a.com/pages/${index + 1}`);
      if (curr) agg.push(`http://a.com/pages/${index + 1}@published`);
      return agg;
    }, []);


  return clayInput.streamPageUris.withArgs(aSite).returns(h(results));
}

describe('Import Api: importPages', function () {
  let sandbox;

  beforeEach(function () {
    sandbox = sinon.sandbox.create();
    sandbox.stub(clayInput, 'streamPageUris');
    sandbox.stub(fetch, 'send');
  });

  afterEach(function () {
    sandbox.restore();
  });

  describe('importPages', function () {

    it ('imports each page of Site A into Site B and returns importUrl results', function () {
      mockPagesIndex(false, false);
      sandbox.stub(importApi, 'importUrl');
      importApi.importUrl.returns(h(['a','b']));
      return fn(aSite, bSite)
        .collect()
        .toPromise(Promise)
        .then((results) => {
          expect(results).to.eql(['a','b']);
          expect(importApi.importUrl.calledOnce).to.be.true;
          expect(importApi.importUrl.firstCall.args[1]).to.equal(bSite);
          return assertStream(importApi.importUrl.firstCall.args[0], [aPage1, aPage2]);
        });
    });


    it ('passes relevant options to importUrl', function () {
      const mockOptions = {
        published: true,
        concurrency: 2,
        key: 'foo',
        overwriteLayouts: true,
        headers: {c: true, d: true}
      };

      mockPagesIndex(false, false);
      sandbox.stub(importApi, 'importUrl');
      importApi.importUrl.returns(h(['a','b']));
      return fn(aSite, bSite, mockOptions)
        .collect()
        .toPromise(Promise)
        .then(() => {
          return expect(importApi.importUrl.firstCall.args[2]).to.eql(_.omit(mockOptions, 'published'));
        });
    });

    it ('does not import published pages by default', function () {
      mockPagesIndex(true, true);
      sandbox.stub(importApi, 'importUrl');
      importApi.importUrl.returns(h(['a','b']));
      return fn(aSite, bSite)
        .collect()
        .toPromise(Promise)
        .then(() => assertStream(importApi.importUrl.firstCall.args[0], [aPage1, aPage2]));
    });

    it ('does not PUT to the same component twice', function () {

      // Site A pages
      mockPagesIndex(false, false);
      mockReq('GET', aPage1, {foo: [aCmpt1Uri]});
      mockReq('GET', aPage2, {foo: [aCmpt1Uri]}); 
      mockReq('GET', aCmpt1UrlJson, {baz: 'zar'});

      // Site B pages
      mockReq('GET', bPage1, 404);
      mockReq('GET', bPage2, 404);
      mockReq('GET', bCmpt1Url, 404);

      // PUTs
      mockReq('PUT', bPage1, 200);
      mockReq('PUT', bPage2, 200);
      mockReq('PUT', bCmpt1Url, 200);

      return fn(aSite, bSite)
        .collect()
        .toPromise(Promise)
        .then(() => {
          matchReq('PUT', bCmpt1Url).length === 1;
        });
    });

    it ('imports both drafts and published pages if opts.published is set', function () {
      mockPagesIndex(true, true);
      sandbox.stub(importApi, 'importUrl');
      importApi.importUrl.returns(h([]));

      return fn(aSite, bSite, {published: true})
        .collect()
        .toPromise(Promise)
        .then(() => {
          // assert that importURL was called with the correct stream of URIs
          assertStream(importApi.importUrl.firstCall.args[0], [
            aPage1,
            `${aPage1}@published`,
            aPage2,
            `${aPage2}@published`
          ]);
        });
    });

    it ('limits pages imported if opts.limit is set', function () {
      mockPagesIndex();

      return fn(aSite, bSite, {limit: 2})
        .collect()
        .toPromise(Promise)
        .then(() => {
          clayInput.streamPageUris.firstCall.args[1].limit === 2;
        });
    });

    it ('offsets pages imported if opts.offset is set', function () {
      mockPagesIndex();

      return fn(aSite, bSite, {offset: 2})
        .collect()
        .toPromise(Promise)
        .then(() => {
          clayInput.streamPageUris.firstCall.args[1].offset === 2;
        });
    });
  });
});

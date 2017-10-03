const lib = require('./import'),
  sinon = require('sinon'),
  fetch = require('../utils/fetch'),
  h = require('highland'),
  clayInput = require('../io/input-clay'),
  {assertReq, matchReq, mockReq, assertItems} = require('../../test/test-util'),
  aSite = 'http://a.com',
  bSite = 'http://b.com',
  aCmpt1Uri = 'a.com/components/foo/instances/1',
  aCmpt2Uri = 'a.com/components/foo/instances/2',
  aCmpt3Uri = 'a.com/components/foo/instances/3',
  aCmpt1Url = `http://${aCmpt1Uri}`,
  aCmpt1UrlJson = `http://${aCmpt1Uri}.json`,
  aPage1 = 'http://a.com/pages/1',
  aPage2 = 'http://a.com/pages/2',
  bPage1 = 'http://b.com/pages/1',
  bPage2 = 'http://b.com/pages/2',
  bCmpt1Uri = 'b.com/components/foo/instances/1',
  bCmpt2Uri = 'b.com/components/foo/instances/2',
  bCmpt3Uri = 'b.com/components/foo/instances/3',
  bCmpt1Url = `http://${bCmpt1Uri}`;

require('../utils/logger').init();

function mockPagesIndex(...pagePublishStates) {
  const results = pagePublishStates
    .map((published, index) => ({
      published,
      uri: `http://a.com/pages/${index + 1}`
    }));

  return clayInput.streamPages.withArgs(aSite).returns(h(results));
}

describe('import api', function () {
  let sandbox;

  beforeEach(function () {
    sandbox = sinon.sandbox.create();
    sandbox.stub(clayInput, 'streamPages');
    sandbox.stub(fetch, 'send');
  });

  afterEach(function () {
    sandbox.restore();
  });

  describe('importUrl', function () {
    const fn = lib[this.title];

    it ('imports page into target site, streaming results objects', function () {
      mockReq('GET', aPage1, {lastModified: 'a'});
      mockReq('GET', bPage1, 404);
      mockReq('PUT', bPage1, 200);
      return fn(aPage1, bSite)
        .collect()
        .toPromise(Promise)
        .then((results) => {
          assertReq('PUT', bPage1, {lastModified: 'a'});
          assertItems(results, [{status: 'success', url: bPage1}]);
        });
    });

    it ('imports all page components into target site', function () {
      mockReq('GET', aPage1, {main: [aCmpt1Uri]});
      mockReq('GET', aCmpt1UrlJson, {
        foo: 'bar',
        someCmpt: {
          _ref: aCmpt2Uri,
          someCmptList: [{
            _ref: aCmpt3Uri
          }]
        }
      });
      mockReq('GET', bPage1, 404);
      mockReq('GET', bCmpt1Url, 404);
      mockReq('PUT', bPage1, 200);
      mockReq('PUT', bCmpt1Url, 200);
      return fn(aPage1, bSite)
        .collect()
        .toPromise(Promise)
        .then((results) => {
          assertReq('PUT', bPage1, {main: [bCmpt1Uri]});
          assertReq('PUT', bCmpt1Url, {
            foo: 'bar',
            someCmpt: {
              _ref: bCmpt2Uri,
              someCmptList: [{
                _ref: bCmpt3Uri
              }]
            }
          });
          assertItems(results, [
            {status: 'success', url: bPage1},
            {status: 'success', url: bCmpt1Url}
          ]);
        });
    });

    it ('imports a component into a target site', function () {
      mockReq('GET', aCmpt1UrlJson, {foo: 'bar'});
      mockReq('GET', bCmpt1Url, 404);
      mockReq('PUT', bCmpt1Url, 200);
      return fn(aCmpt1Url, bSite)
        .collect()
        .toPromise(Promise)
        .then((results) => {
          assertReq('PUT', bCmpt1Url, {foo: 'bar'});
          assertItems(results, [{status: 'success', url:bCmpt1Url}]);
        });
    });

    it ('imports a list into a target site', function () {
      mockReq('GET', 'http://a.com/lists/a', ['a', 'b', 'c']);
      mockReq('GET', 'http://b.com/lists/a', 404);
      mockReq('PUT', 'http://b.com/lists/a', 200);
      return fn('http://a.com/lists/a', bSite)
        .collect()
        .toPromise(Promise)
        .then((results) => {
          assertReq('PUT', 'http://b.com/lists/a', ['a','b','c']);
          assertItems(results, [
            {status: 'success', url: 'http://b.com/lists/a'}
          ]);
        });
    });

    it ('merges source list into target site list if target site already has list', function () {
      mockReq('GET', 'http://a.com/lists/a', ['a', 'b', 'c']);
      mockReq('GET', 'http://b.com/lists/a', ['b', 'c', 'd']);
      mockReq('PUT', 'http://b.com/lists/a', 200);
      return fn('http://a.com/lists/a', bSite)
        .collect()
        .toPromise(Promise)
        .then(() => {
          assertReq('PUT', 'http://b.com/lists/a', ['a','b','c','d']);
        });
    });

    it ('does not overwrite pages or components by default', function () {
      mockReq('GET', aPage1, {main: [aCmpt1Uri]});
      mockReq('GET', aCmpt1UrlJson, {});
      mockReq('GET', bPage1, {});
      mockReq('GET', bCmpt1Url, {});
      return fn(aPage1, bSite)
        .collect()
        .toPromise(Promise)
        .then((results) => {
          expect(matchReq('PUT', bPage1).length).to.equal(0);
          expect(matchReq('PUT', bCmpt1Uri).length).to.equal(0);
          assertItems(results, [
            {url: bPage1, status: 'skipped'},
            {url: bCmpt1Url, status: 'skipped'}
          ]);
        });
    });

    it ('overwrites page if overwrite includes "pages"', function () {
      mockReq('GET', aPage1, {foo: 'bar'});
      mockReq('PUT', bPage1, 200);
      return fn(aPage1, bSite, {overwrite: ['pages']})
        .collect()
        .toPromise(Promise)
        .then(() => {
          assertReq('PUT', bPage1, {foo: 'bar'});
        });
    });

    it ('overwrites page-level components if overwrite includes "components"', function () {
      mockReq('GET', aCmpt1UrlJson, {foo: 'bar'});
      mockReq('PUT', bCmpt1Url, 200);
      return fn(aCmpt1Url, bSite, {overwrite: ['components']})
        .collect()
        .toPromise(Promise)
        .then(() => {
          assertReq('PUT', bCmpt1Url, {foo: 'bar'});
        });
    });

    it ('does not overwrite layouts even if "components" is included in "overwrite" option', function () {
      mockReq('GET', aPage1, {layout: aCmpt1Uri});
      mockReq('GET', aCmpt1UrlJson, {});
      mockReq('GET', bPage1, {});
      mockReq('GET', bCmpt1Url, {});
      mockReq('PUT', bPage1, 200);
      return fn(aPage1, bSite, {overwrite: ['pages', 'components']})
        .collect()
        .toPromise(Promise)
        .then((results) => {
          assertReq('PUT', bPage1, {layout: bCmpt1Uri});
          expect(matchReq('PUT', bCmpt1Url).length).to.equal(0);
          assertItems(results, [
            {url: bPage1, status: 'success'},
            {url: bCmpt1Url, status: 'skipped'}
          ]);
        });
    });

    it ('overwrites lists if overwrite includes "lists" (i.e. do not merge)', function () {
      mockReq('GET', 'http://a.com/lists/a', ['a', 'b', 'c']);
      mockReq('GET', 'http://b.com/lists/a', ['d', 'e', 'f']);
      mockReq('PUT', 'http://b.com/lists/a', 200);
      return fn('http://a.com/lists/a', bSite, {overwrite: ['lists']})
        .collect()
        .toPromise(Promise)
        .then(() => {
          assertReq('PUT', 'http://b.com/lists/a', ['a','b','c']);
        });
    });

    it ('overwrites layouts when overwrite includes "layouts"', function () {
      mockReq('GET', aPage1, {layout: aCmpt1Uri});
      mockReq('GET', aCmpt1UrlJson, {foo: 'bar'});
      mockReq('GET', bPage1, {});
      mockReq('GET', bCmpt1Url, {});
      mockReq('PUT', bCmpt1Url, 200);
      mockReq('PUT', bPage1, 200);
      return fn(aPage1, bSite, {overwrite: ['layouts', 'components']})
        .collect()
        .toPromise(Promise)
        .then(() => {
          assertReq('PUT', bCmpt1Url, {foo: 'bar'});
        });
    });

    it ('throws error if overwrite includes "all" with other resource types', function () {
      expect(() => fn(aCmpt1Url, bSite, {overwrite: ['all', 'components']})).to.throw(Error);
    });

    it ('throws error if overwrite includes "layouts" without "components"', function () {
      expect(() => fn(aCmpt1Url, bSite, {overwrite: ['layouts']})).to.throw(Error);
    });
  });

  describe('importPages', function () {
    const fn = lib[this.title];

    it ('imports each page of Site A into Site B', function () {
      mockPagesIndex(false, false);
      mockReq('GET', aPage1, {foo: 'bar'});
      mockReq('GET', aPage2, {baz: 'zar'});
      mockReq('GET', bPage1, 404);
      mockReq('GET', bPage2, 404);
      mockReq('PUT', bPage1, 200);
      mockReq('PUT', bPage2, 200);
      return fn(aSite, bSite)
        .collect()
        .toPromise(Promise)
        .then((results) => {
          assertReq('PUT', bPage1, {foo: 'bar'});
          assertReq('PUT', bPage2, {baz: 'zar'});
          assertItems(results, [
            {url: bPage1, status: 'success'},
            {url: bPage2, status: 'success'}
          ]);
        });
    });

    it ('imports page components', function () {
      mockPagesIndex(false);
      mockReq('GET', aPage1, {main: [aCmpt1Uri]});
      mockReq('GET', aCmpt1UrlJson, {foo: 'bar'});
      mockReq('GET', bPage1, 404);
      mockReq('GET', bCmpt1Url, 404);
      mockReq('PUT', bPage1, 200);
      mockReq('PUT', bCmpt1Url, 200);
      return fn(aSite, bSite)
        .collect()
        .toPromise(Promise)
        .then((results) => {
          assertReq('PUT', bPage1, {main: [bCmpt1Uri]});
          assertReq('PUT', bCmpt1Url, {foo: 'bar'});
          assertItems(results, [
            {url: bPage1, status: 'success'},
            {url: bCmpt1Url, status: 'success'}
          ]);
        });
    });

    it ('does not overwrite existing pages or components by default', function () {
      mockPagesIndex(false);
      mockReq('GET', aPage1, {main: [aCmpt1Uri]});
      mockReq('GET', aCmpt1UrlJson, {});
      mockReq('GET', bPage1, {});
      mockReq('GET', bCmpt1Url, {});

      return fn(aSite, bSite)
        .collect()
        .toPromise(Promise)
        .then((results) => {
          assertItems(results, [
            {url: bPage1, status: 'skipped'},
            {url: bCmpt1Url, status: 'skipped'},
          ]);
        });
    });

    it ('overwrites existing pages if overwrite includes "pages"', function () {
      mockPagesIndex(false);
      mockReq('GET', aPage1, {foo: 'bar'});
      mockReq('GET', bPage1, {});
      mockReq('PUT', bPage1, 200);

      return fn(aSite, bSite, {overwrite: ['pages']})
        .collect()
        .toPromise(Promise)
        .then((results) => {
          assertReq('PUT', bPage1, {foo: 'bar'});
          assertItems(results, [
            {url: bPage1, status: 'success'},
          ]);
        });
    });

    it ('overwrites existing components if overwrite includes "components"', function () {
      mockPagesIndex(false);
      mockReq('GET', aPage1, {main: [aCmpt1Uri]});
      mockReq('GET', aCmpt1UrlJson, {foo: 'bar'});
      mockReq('GET', bPage1, {});
      mockReq('GET', bCmpt1Url, {});
      mockReq('PUT', bPage1, 200);
      mockReq('PUT', bCmpt1Url, 200);

      return fn(aSite, bSite, {overwrite: ['pages', 'components']})
        .collect()
        .toPromise(Promise)
        .then((results) => {
          assertReq('PUT', bPage1, {main: [bCmpt1Uri]});
          assertReq('PUT', bCmpt1Url, {foo: 'bar'});
          assertItems(results, [
            {url: bPage1, status: 'success'},
            {url: bCmpt1Url, status: 'success'},
          ]);
        });
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

    it ('imports both drafts and published pages if "published" is set', function () {
      mockPagesIndex(true, true);

      // Site A pages
      mockReq('GET', aPage1, {foo: 'bar'});
      mockReq('GET', aPage2, {baz: 'zar'});
      mockReq('GET', `${aPage1}@published`, {har: 'lar'});
      mockReq('GET', `${aPage2}@published`, {kar: 'mar'});

      // Site B pages
      mockReq('GET', bPage1, 404);
      mockReq('GET', bPage2, 404);
      mockReq('GET', `${bPage1}@published`, 404);
      mockReq('GET', `${bPage2}@published`, 404);

      // PUTs
      mockReq('PUT', bPage1, 200);
      mockReq('PUT', bPage2, 200);
      mockReq('PUT', `${bPage1}@published`, 200);
      mockReq('PUT', `${bPage2}@published`, 200);

      return fn(aSite, bSite, {published: true})
        .collect()
        .toPromise(Promise)
        .then((results) => {
          assertReq('PUT', bPage1, {foo: 'bar'});
          assertReq('PUT', bPage2, {baz: 'zar'});
          assertReq('PUT', `${bPage1}@published`, {har: 'lar'});
          assertReq('PUT', `${bPage2}@published`, {kar: 'mar'});
          assertItems(results, [
            {url: bPage1, status: 'success'},
            {url: bPage2, status: 'success'},
            {url: `${bPage1}@published`, status: 'success'},
            {url: `${bPage2}@published`, status: 'success'}
          ]);
        });
    });

    it ('limits page imports if "limit" is set', function () {
      mockPagesIndex(true, true);

      // Site A pages
      mockReq('GET', aPage1, {foo: 'bar'});
      mockReq('GET', aPage2, {baz: 'zar'});

      // Site B pages
      mockReq('GET', bPage1, 404);
      mockReq('GET', bPage2, 404);

      // PUTs
      mockReq('PUT', bPage1, 200);
      mockReq('PUT', bPage2, 200);

      return fn(aSite, bSite, {limit: 2})
        .collect()
        .toPromise(Promise)
        .then(() => {
          clayInput.streamPages.firstCall.args[1].limit === 2;
        });
    });

    it ('offsets pages imports if "offset" is set', function () {
      mockPagesIndex(true, true);

      // Site A pages
      mockReq('GET', aPage1, {foo: 'bar'});
      mockReq('GET', aPage2, {baz: 'zar'});

      // Site B pages
      mockReq('GET', bPage1, 404);
      mockReq('GET', bPage2, 404);

      // PUTs
      mockReq('PUT', bPage1, 200);
      mockReq('PUT', bPage2, 200);

      return fn(aSite, bSite, {offset: 2})
        .collect()
        .toPromise(Promise)
        .then(() => {
          clayInput.streamPages.firstCall.args[1].offset === 2;
        });
    });

  });

  describe('importSite', function () {
    const fn = lib[this.title];

    beforeEach(function () {
      sandbox.stub(lib, 'importPages');
      sandbox.stub(lib, 'importLists');
      lib.importPages.returns(h(['a', 'b']));
      lib.importLists.returns(h(['c', 'd']));
    });

    it ('calls importPages and importLists, passing all relevant arguments and options and merging results', function () {
      const opts = {limit: 1, offset: 2, concurrency: 3, key: 'foo', sourceKey: 'bar', overwrite: ['components'], published: true, headers: {foo: 'bar'}};

      return fn(aSite, bSite, opts)
        .collect()
        .toPromise(Promise)
        .then((results) => {
          let pagesCall = lib.importPages.getCalls()[0],
            listsCall = lib.importLists.getCalls()[0];

          expect(pagesCall.args[0]).to.equal(aSite);
          expect(pagesCall.args[1]).to.equal(bSite);
          expect(pagesCall.args[2]).to.eql(opts);
          expect(listsCall.args[0]).to.equal(aSite);
          expect(listsCall.args[1]).to.equal(bSite);
          expect(listsCall.args[2]).to.eql({
            key: 'foo',
            concurrency: 3,
            overwrite: ['components']
          });
          assertItems(results, ['a','b','c','d']);
        });
    });
  });

  describe('importLists', function () {
    const fn = lib[this.title];

    beforeEach(function () {
      sandbox.stub(clayInput, 'streamLists');
      sandbox.stub(lib, 'importUrl');
      lib.importUrl.withArgs('http://a.com/lists/foo').returns(h(['a','b']));
      lib.importUrl.withArgs('http://a.com/lists/bar').returns(h(['c','d']));
    });

    it ('calls importUrl with all relevant arguments and options for each list in site', function () {
      const mockOpts = {key: 'foo', concurrency: 1, headers: {foo: 'bar'}, overwrite: ['lists']};

      clayInput.streamLists.withArgs(aSite).returns(h(['a.com/lists/foo', 'a.com/lists/bar']));
      return fn(aSite, bSite, mockOpts)
        .collect()
        .toPromise(Promise)
        .then((results) => {
          const authorsCall = lib.importUrl.getCalls()[0],
            pagesCall = lib.importUrl.getCalls()[1];

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

});

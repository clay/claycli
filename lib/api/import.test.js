const lib = require('./import'),
  sinon = require('sinon'),
  fetch = require('../utils/fetch'),
  h = require('highland'),
  clayInput = require('../io/input-clay'),
  _ = require('lodash'),
  files = require('../io/input-files'),
  {
    assertReq,
    matchReq,
    mockReq,
    assertItems,
    assertStream
  } = require('../../test/test-util'),
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
  bCmpt1Url = `http://${bCmpt1Uri}`,
  bCmpt2Url = `http://${bCmpt2Uri}`,
  bCmpt3Url = `http://${bCmpt3Uri}`,
  chunk1Uri = '/components/foo/instances/1',
  chunk2Uri = '/components/foo/instances/2',
  chunk1 = {[chunk1Uri]: {a: 'b'}},
  chunk2 = {[chunk2Uri]: {c: 'd'}};

require('../utils/logger').init();

function mockPagesIndex(...pagePublishStates) {
  const results = pagePublishStates
    .reduce((agg, curr, index) => {
      agg.push(`http://a.com/pages/${index + 1}`);
      if (curr) agg.push(`http://a.com/pages/${index + 1}@published`);
      return agg;
    }, []);


  return clayInput.streamPageUris.withArgs(aSite).returns(h(results));
}

describe('import api', function () {
  let sandbox;

  beforeEach(function () {
    sandbox = sinon.sandbox.create();
    sandbox.stub(clayInput, 'streamPageUris');
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
        })
        .catch((err) => {
          console.log(err);
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

    it ('adds missing layouts and their children', function () {
      mockReq('GET', aPage1, {layout: aCmpt1Uri});
      mockReq('GET', aCmpt1UrlJson, {
        someCmpt: {
          _ref: aCmpt2Uri,
          someCmptList: [{_ref: aCmpt3Uri, foo: 'bar'}]
        }
      });

      // gets
      mockReq('GET', bPage1, 404);
      mockReq('GET', bCmpt1Url, 404);
      mockReq('GET', bCmpt2Url, 404);
      mockReq('GET', bCmpt3Url, 404);

      mockReq('PUT', bPage1, 200);
      mockReq('PUT', bCmpt1Url, 200);
      mockReq('PUT', bCmpt2Url, 200);
      mockReq('PUT', bCmpt3Url, 200);

      return fn(aPage1, bSite).collect().toPromise(Promise).then((results) => {
        assertReq('PUT', bPage1, {layout: bCmpt1Uri});
        assertReq('PUT', bCmpt1Url, {someCmpt: {_ref: bCmpt2Uri}});
        assertReq('PUT', bCmpt2Url, {someCmptList: [{_ref: bCmpt3Uri}]});
        assertReq('PUT', bCmpt3Url, {foo: 'bar'});
        assertItems(results, [
          {status: 'success', url: bPage1},
          {status: 'success', url: bCmpt1Url},
          {status: 'success', url: bCmpt2Url},
          {status: 'success', url: bCmpt3Url}
        ]);
      });
    });

    it ('does not overwrite layouts and their children', function () {
      mockReq('GET', aPage1, {layout: aCmpt1Uri});
      mockReq('GET', aCmpt1UrlJson, {
        someCmpt: {
          _ref: aCmpt2Uri,
          someCmptList: [{_ref: aCmpt3Uri, foo: 'bar'}]
        }
      });

      // gets
      mockReq('GET', bPage1, {});
      mockReq('GET', bCmpt1Url, {});
      mockReq('GET', bCmpt2Url, {});
      mockReq('GET', bCmpt3Url, {});

      mockReq('PUT', bPage1, 200);

      return fn(aPage1, bSite).collect().toPromise(Promise).then((results) => {
        assertReq('PUT', bPage1, {layout: bCmpt1Uri});
        assertItems(results, [
          {status: 'success', url: bPage1},
          {status: 'skipped', url: bCmpt1Url},
          {status: 'skipped', url: bCmpt2Url},
          {status: 'skipped', url: bCmpt3Url}
        ]);
      });
    });

    it ('ovewrites layouts and their children if overwriteLayouts is set', function () {
      mockReq('GET', aPage1, {layout: aCmpt1Uri});
      mockReq('GET', aCmpt1UrlJson, {
        someCmpt: {
          _ref: aCmpt2Uri,
          someCmptList: [{_ref: aCmpt3Uri, foo: 'bar'}]
        }
      });

      // gets
      mockReq('GET', bPage1, {});
      mockReq('GET', bCmpt1Url, {});
      mockReq('GET', bCmpt2Url, {});
      mockReq('GET', bCmpt3Url, {});

      mockReq('PUT', bPage1, 200);
      mockReq('PUT', bCmpt1Url, 200);
      mockReq('PUT', bCmpt2Url, 200);
      mockReq('PUT', bCmpt3Url, 200);

      return fn(aPage1, bSite, {overwriteLayouts: true}).collect().toPromise(Promise).then((results) => {
        assertReq('PUT', bPage1, {layout: bCmpt1Uri});
        assertReq('PUT', bCmpt1Url, {
          someCmpt: {
            _ref: bCmpt2Uri,
            someCmptList: [{_ref: bCmpt3Uri, foo: 'bar'}]
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

    it ('imports a user into a target site', function () {
      mockReq('GET', 'http://a.com/users/a', {a: 'b'});
      mockReq('GET', 'http://b.com/users/a', 404);
      mockReq('PUT', 'http://b.com/users/a', 200);
      return fn('http://a.com/users/a', bSite)
        .collect()
        .toPromise(Promise)
        .then((results) => {
          assertReq('PUT', 'http://b.com/users/a', {a: 'b'});
          assertItems(results, [
            {status: 'success', url: 'http://b.com/users/a'}
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

  });

  describe('importPages', function () {
    const fn = lib[this.title];

    it ('imports each page of Site A into Site B and returns importUrl results', function () {
      mockPagesIndex(false, false);
      sandbox.stub(lib, 'importUrl');
      lib.importUrl.returns(h(['a','b']));
      return fn(aSite, bSite)
        .collect()
        .toPromise(Promise)
        .then((results) => {
          expect(results).to.eql(['a','b']);
          expect(lib.importUrl.calledOnce).to.be.true;
          expect(lib.importUrl.firstCall.args[1]).to.equal(bSite);
          return assertStream(lib.importUrl.firstCall.args[0], [aPage1, aPage2]);
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
      sandbox.stub(lib, 'importUrl');
      lib.importUrl.returns(h(['a','b']));
      return fn(aSite, bSite, mockOptions)
        .collect()
        .toPromise(Promise)
        .then(() => {
          return expect(lib.importUrl.firstCall.args[2]).to.eql(_.omit(mockOptions, 'published'));
        });
    });

    it ('does not import published pages by default', function () {
      mockPagesIndex(true, true);
      sandbox.stub(lib, 'importUrl');
      lib.importUrl.returns(h(['a','b']));
      return fn(aSite, bSite)
        .collect()
        .toPromise(Promise)
        .then(() => assertStream(lib.importUrl.firstCall.args[0], [aPage1, aPage2]));
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
      sandbox.stub(lib, 'importUrl');
      lib.importUrl.returns(h([]));

      return fn(aSite, bSite, {published: true})
        .collect()
        .toPromise(Promise)
        .then(() => {
          // assert that importURL was called with the correct stream of URIs
          assertStream(lib.importUrl.firstCall.args[0], [
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

  describe('importSite', function () {
    const fn = lib[this.title];

    beforeEach(function () {
      sandbox.stub(lib, 'importPages');
      sandbox.stub(lib, 'importLists');
      lib.importPages.returns(h(['a', 'b']));
      lib.importLists.returns(h(['c', 'd']));
    });

    it ('calls importPages and importLists, passing all relevant arguments and options and merging results', function () {
      const opts = {limit: 1, offset: 2, concurrency: 3, key: 'foo', sourceKey: 'bar', overwriteLayouts: true, published: true, headers: {foo: 'bar'}};

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
            concurrency: 3
          });
          assertItems(results, ['a','b','c','d']);
        });
    });
  });

  describe('importLists', function () {
    const fn = lib[this.title];

    beforeEach(function () {
      sandbox.stub(clayInput, 'streamListUris');
      sandbox.stub(lib, 'importUrl');
      lib.importUrl.withArgs('http://a.com/lists/foo').returns(h(['a','b']));
      lib.importUrl.withArgs('http://a.com/lists/bar').returns(h(['c','d']));
    });

    it ('calls importUrl with all relevant arguments and options for each list in site', function () {
      const mockOpts = {key: 'foo', concurrency: 1, headers: {foo: 'bar'}};

      clayInput.streamListUris.withArgs(aSite).returns(h(['a.com/lists/foo', 'a.com/lists/bar']));
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

  describe('importUsers', function () {
    const fn = lib[this.title];

    beforeEach(function () {
      sandbox.stub(clayInput, 'streamUserUris');
      sandbox.stub(lib, 'importUrl');
      lib.importUrl.withArgs('http://a.com/users/foo').returns(h(['a','b']));
      lib.importUrl.withArgs('http://a.com/users/bar').returns(h(['c','d']));
    });

    it ('calls importUrl with all relevant arguments and options for each list in site', function () {
      const mockOpts = {key: 'foo', concurrency: 1, headers: {foo: 'bar'}};

      clayInput.streamUserUris.withArgs(aSite).returns(h(['a.com/users/foo', 'a.com/users/bar']));
      return fn(aSite, bSite, mockOpts)
        .collect()
        .toPromise(Promise)
        .then((results) => {
          const authorsCall = lib.importUrl.getCalls()[0],
            pagesCall = lib.importUrl.getCalls()[1];

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

  describe('importFile', function () {
    const fn = lib[this.title],
      mockFile = '/some/file';

    beforeEach(function () {
      sandbox.stub(files, 'get');
    });

    it ('imports assets from the specified file', function () {
      files.get.withArgs(mockFile).returns(h([chunk1, chunk2]));
      mockReq('PUT', `${bSite}${chunk1Uri}`, 200);
      mockReq('PUT', `${bSite}${chunk2Uri}`, 200);
      return fn(mockFile, bSite).collect().toPromise(Promise).then((results) => {
        assertItems(results, [
          {
            status: 'success',
            url: `${bSite}${chunk1Uri}`
          }, {
            status: 'success',
            url: `${bSite}${chunk2Uri}`
          }
        ]);
      });
    });

    it ('omit schemas', function () {
      files.get.withArgs(mockFile).returns(h([
        chunk1,
        {'schema.yml': {c: 'd'}}
      ]));
      mockReq('PUT', `${bSite}${chunk1Uri}`, 200);
      mockReq('PUT', `${bSite}/components/foo/instances/2`, 200);
      return fn(mockFile, bSite).collect().toPromise(Promise).then((results) => {
        assertItems(results, [{
          status: 'success',
          url: `${bSite}${chunk1Uri}`
        }]);
      });
    });
  });

  describe('importChunk', function () {
    const fn = lib[this.title];

    it ('imports a single chunk', function () {
      mockReq('PUT', `${bSite}${chunk1Uri}`, 200);
      return fn(chunk1, bSite).collect().toPromise(Promise).then((results) => {
        assertItems(results, [{
          status: 'success',
          url: `${bSite}${chunk1Uri}`
        }]);
      });
    });
    it ('imports an array of chunks', function () {
      mockReq('PUT', `${bSite}${chunk1Uri}`, 200);
      mockReq('PUT', `${bSite}${chunk2Uri}`, 200);
      return fn([chunk1, chunk2], bSite).collect().toPromise(Promise).then((results) => {
        assertItems(results, [{
          status: 'success',
          url: `${bSite}${chunk1Uri}`
        }, {
          status: 'success',
          url: `${bSite}${chunk2Uri}`
        }]);
      });
    });
    it ('imports a stream of chunks', function () {
      mockReq('PUT', `${bSite}${chunk1Uri}`, 200);
      mockReq('PUT', `${bSite}${chunk2Uri}`, 200);
      return fn(h([chunk1, chunk2]), bSite).collect().toPromise(Promise).then((results) => {
        assertItems(results, [{
          status: 'success',
          url: `${bSite}${chunk1Uri}`
        }, {
          status: 'success',
          url: `${bSite}${chunk2Uri}`
        }]);
      });
    });
  });
});

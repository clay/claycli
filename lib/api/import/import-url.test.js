const fn = require('./index').importUrl,
  sinon = require('sinon'),
  fetch = require('../../utils/fetch'),
  {assertReq, mockReq, assertItems} = require('../../../test/test-util'),
  bSite = 'http://b.com',
  aCmpt1Uri = 'a.com/components/foo/instances/1',
  aCmpt2Uri = 'a.com/components/foo/instances/2',
  aCmpt3Uri = 'a.com/components/foo/instances/3',
  aCmpt1Url = `http://${aCmpt1Uri}`,
  aCmpt1UrlJson = `http://${aCmpt1Uri}.json`,
  aPage1 = 'http://a.com/pages/1',
  bPage1 = 'http://b.com/pages/1',
  bCmpt1Uri = 'b.com/components/foo/instances/1',
  bCmpt2Uri = 'b.com/components/foo/instances/2',
  bCmpt3Uri = 'b.com/components/foo/instances/3',
  bCmpt1Url = `http://${bCmpt1Uri}`,
  bCmpt2Url = `http://${bCmpt2Uri}`,
  bCmpt3Url = `http://${bCmpt3Uri}`;

describe('Import API: importUrl', function () {
  let sandbox;

  beforeEach(function () {
    sandbox = sinon.sandbox.create();
    sandbox.stub(fetch, 'send');
  });
  afterEach(function () {
    sandbox.restore();
  });

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

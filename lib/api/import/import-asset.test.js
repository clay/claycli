const fn = require('./index').importAsset,
  sinon = require('sinon'),
  fetch = require('../../utils/fetch'),
  h = require('highland'),
  {mockReq, assertItems, assertReq} = require('../../../test/test-util');

describe('Import API: importAsset', function () {
  let sandbox;

  beforeEach(function () {
    sandbox = sinon.sandbox.create();
    sandbox.stub(fetch, 'send');
  });

  afterEach(function () {
    sandbox.restore();
  });

  it ('PUTs the specified asset and returns the results', function () {
    const mockAsset = {
      data: {foo: 'bar'},
      url: 'http://baz.com/zar'
    };

    mockReq('PUT', mockAsset.url, 200);
    return fn(mockAsset)
      .collect()
      .toPromise(Promise)
      .then((results) => {
        expect(results[0]).to.eql({
          url: mockAsset.url,
          status: 'success'
        });
      });
  });

  it ('accepts array of URLs', function () {
    const mockAssets = [{
      data: {1: '2'},
      url: 'http://3.com/4'
    }, {
      data: {3: '4'},
      url: 'http://5.com/6'
    }];

    mockReq('PUT', mockAssets[0].url, 200);
    mockReq('PUT', mockAssets[1].url, 200);
    return fn(mockAssets)
      .collect()
      .toPromise(Promise)
      .then((results) => {
        assertItems(results, [{
          url: mockAssets[0].url,
          status: 'success'
        }, {
          url: mockAssets[1].url,
          status: 'success'
        }]);
      });
  });

  it ('accepts a stream of URLs', function () {
    const mockAssets = [{
      data: {1: '2'},
      url: 'http://3.com/4'
    }, {
      data: {3: '4'},
      url: 'http://5.com/6'
    }];

    mockReq('PUT', mockAssets[0].url, 200);
    mockReq('PUT', mockAssets[1].url, 200);
    return fn(h(mockAssets))
      .collect()
      .toPromise(Promise)
      .then((results) => {
        assertItems(results, [{
          url: mockAssets[0].url,
          status: 'success'
        }, {
          url: mockAssets[1].url,
          status: 'success'
        }]);
      });
  });

  it ('PUTs with text if asset is URI (i.e. from /uris endpoint)', function () {
    const mockAsset = {
      data: 'foo',
      url: 'http://baz.com/uris/zar'
    };

    mockReq('PUT', mockAsset.url, 200);
    return fn(mockAsset)
      .collect()
      .toPromise(Promise)
      .then((results) => {
        expect(results[0]).to.eql({
          url: mockAsset.url,
          status: 'success'
        });
        assertReq('PUT', mockAsset.url, 'foo');
      });
  });

  it ('skips asset if "skip" is true, and sets result status to "skipped"', function () {
    const mockAsset = {
      data: {foo: 'bar'},
      url: 'http://baz.com/zar',
      skip: true
    };

    return fn(mockAsset)
      .collect()
      .toPromise(Promise)
      .then((results) => {
        expect(results[0]).to.eql({
          url: mockAsset.url,
          status: 'skipped'
        });
      });
  });

});

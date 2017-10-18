const fn = require('./index').importAsset,
  sinon = require('sinon'),
  fetch = require('../../utils/fetch'),
  {mockReq} = require('../../../test/test-util');

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

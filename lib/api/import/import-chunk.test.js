const fn = require('./import-chunk'),
  sinon = require('sinon'),
  fetch = require('../../utils/fetch'),
  h = require('highland'),
  {
    mockReq,
    assertItems
  } = require('../../../test/test-util'),
  bSite = 'http://b.com',
  chunk1Uri = '/components/foo/instances/1',
  chunk2Uri = '/components/foo/instances/2',
  chunk1 = {[chunk1Uri]: {a: 'b'}},
  chunk2 = {[chunk2Uri]: {c: 'd'}};

require('../../utils/logger').init();

describe('Import API: importChunk', function () {
  let sandbox;

  beforeEach(function () {
    sandbox = sinon.sandbox.create();
    sandbox.stub(fetch, 'send');
  });

  afterEach(function () {
    sandbox.restore();
  });

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

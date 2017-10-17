const fn = require('./import-file'),
  sinon = require('sinon'),
  fetch = require('../../utils/fetch'),
  h = require('highland'),
  files = require('../../io/input-files'),
  {
    mockReq,
    assertItems,
  } = require('../../../test/test-util'),
  bSite = 'http://b.com',
  chunk1Uri = '/components/foo/instances/1',
  chunk2Uri = '/components/foo/instances/2',
  chunk1 = {[chunk1Uri]: {a: 'b'}},
  chunk2 = {[chunk2Uri]: {c: 'd'}};

require('../../utils/logger').init();

describe('Import Api: importFile', function () {
  let sandbox;
  const mockFile = '/some/file';

  beforeEach(function () {
    sandbox = sinon.sandbox.create();
    sandbox.stub(fetch, 'send');
    sandbox.stub(files, 'get');
  });

  afterEach(function () {
    sandbox.restore();
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

const importApi = require('./index'),
  fn = importApi.importUris,
  sinon = require('sinon'),
  h = require('highland'),
  clayInput = require('../../io/input-clay'),
  {assertItems} = require('../../../test/test-util'),
  aSite = 'http://a.com',
  bSite = 'http://b.com';

require('../../utils/logger').init();

describe('Import API: importUris', function () {
  let sandbox;

  beforeEach(function () {
    sandbox = sinon.sandbox.create();
    sandbox.stub(clayInput, 'streamUris');
    sandbox.stub(importApi, 'importUrl');
    importApi.importUrl.withArgs('http://a.com/uris/foo').returns(h(['a','b']));
    importApi.importUrl.withArgs('http://a.com/uris/bar').returns(h(['c','d']));
  });

  afterEach(function () {
    sandbox.restore();
  });

  it ('calls importUrl with all relevant arguments and options for each URI in site', function () {
    const mockOpts = {key: 'foo', concurrency: 1, headers: {foo: 'bar'}};

    clayInput.streamUris.withArgs(aSite).returns(h(['a.com/uris/foo', 'a.com/uris/bar']));

    return fn(aSite, bSite, mockOpts)
      .collect()
      .toPromise(Promise)
      .then((results) => {
        assertItems(results, ['a','b','c','d']);
      });
  });
});

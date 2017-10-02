const lib = require('./import'),
  sinon = require('sinon'),
  fetch = require('../utils/fetch'),
  h = require('highland'),
  clayInput = require('../io/input-clay'),
  {assertReq, matchReq, mockReq} = require('../../test/test-util');

require('../utils/logger').init();

function mockPagesIndex(...pagePublishStates) {
  const results = pagePublishStates
    .map((published, index) => ({
      published,
      uri: `http://a.com/pages/${index}`
    }));

  return clayInput.getPagesInSite.withArgs('http://a.com').returns(h(results));
}

describe('import api', function () {
  let sandbox;

  beforeEach(function () {
    sandbox = sinon.sandbox.create();
    sandbox.stub(clayInput, 'getPagesInSite');
    sandbox.stub(fetch, 'send');
  });

  afterEach(function () {
    sandbox.restore();
  });

  describe('importUrl', function () {
    const fn = lib[this.title];

    it ('imports page', function () {
      mockReq('GET', 'http://a.com/pages/1', {lastModified: 'a'});
      mockReq('GET', 'http://b.com/pages/1', 404);
      mockReq('PUT', 'http://b.com/pages/1', 200);
      return fn('http://a.com/pages/1', 'http://b.com')
        .collect()
        .toPromise(Promise)
        .then(() => {
          assertReq('PUT', 'http://b.com/pages/1', {lastModified: 'a'});
        });
    });

    it ('imports all page components, replacing prefixes through deep cmpt', function () {
      mockReq('GET', 'http://a.com/pages/1', {
        main: [
          'a.com/components/a/instances/foo'
        ],
      });
      mockReq('GET', 'http://a.com/components/a/instances/foo.json', {
        foo: 'bar',
        someCmpt: {
          _ref: 'a.com/components/a/instances/bar',
          someCmptList: [{
            _ref: 'a.com/components/a/instances/car'
          }]
        }
      });
      mockReq('GET', 'http://b.com/pages/1', 404);
      mockReq('GET', 'http://b.com/components/a/instances/foo', 404);
      mockReq('PUT', 'http://b.com/pages/1', 200);
      mockReq('PUT', 'http://b.com/components/a/instances/foo', 200);
      return fn('http://a.com/pages/1', 'http://b.com')
        .collect()
        .toPromise(Promise)
        .then(() => {
          assertReq('PUT', 'http://b.com/pages/1', {
            main: ['b.com/components/a/instances/foo']
          });
          assertReq('PUT', 'http://b.com/components/a/instances/foo', {
            foo: 'bar',
            someCmpt: {
              _ref: 'b.com/components/a/instances/bar',
              someCmptList: [{
                _ref: 'b.com/components/a/instances/car'
              }]
            }
          });
        });
    });

    it ('imports a component into a target site', function () {
      mockReq('GET', 'http://a.com/components/a/instances/1.json', {foo: 'bar'});
      mockReq('GET', 'http://b.com/components/a/instances/1', 404);
      mockReq('PUT', 'http://b.com/components/a/instances/1', 200);
      return fn('http://a.com/components/a/instances/1', 'http://b.com')
        .collect()
        .toPromise(Promise)
        .then(() => {
          assertReq('PUT', 'http://b.com/components/a/instances/1', {
            foo: 'bar'
          });
        });
    });

    it ('imports a list into a target site', function () {
      mockReq('GET', 'http://a.com/lists/a', ['a', 'b', 'c']);
      mockReq('GET', 'http://b.com/lists/a', 404);
      mockReq('PUT', 'http://b.com/lists/a', 200);
      return fn('http://a.com/lists/a', 'http://b.com')
        .collect()
        .toPromise(Promise)
        .then(() => {
          assertReq('PUT', 'http://b.com/lists/a', ['a','b','c']);
        });
    });

    it ('if target site list exists, merge into it by default', function () {
      mockReq('GET', 'http://a.com/lists/a', ['a', 'b', 'c']);
      mockReq('GET', 'http://b.com/lists/a', ['b', 'c', 'd']);
      mockReq('PUT', 'http://b.com/lists/a', 200);
      return fn('http://a.com/lists/a', 'http://b.com')
        .collect()
        .toPromise(Promise)
        .then(() => {
          assertReq('PUT', 'http://b.com/lists/a', ['a','b','c','d']);
        });
    });

    it ('overwrite lists if ovewrite includes "lists" (do not merge)', function () {
      mockReq('GET', 'http://a.com/lists/a', ['a', 'b', 'c']);
      mockReq('GET', 'http://b.com/lists/a', ['d', 'e', 'f']);
      mockReq('PUT', 'http://b.com/lists/a', 200);
      return fn('http://a.com/lists/a', 'http://b.com', {overwrite: ['lists']})
        .collect()
        .toPromise(Promise)
        .then(() => {
          assertReq('PUT', 'http://b.com/lists/a', ['a','b','c']);
        });
    });

    it ('overwrites page if overwrite includes "pages"', function () {
      mockReq('GET', 'http://a.com/pages/1', {foo: 'bar'});
      mockReq('PUT', 'http://b.com/pages/1', 200);
      return fn('http://a.com/pages/1', 'http://b.com', {overwrite: ['pages']})
        .collect()
        .toPromise(Promise)
        .then(() => {
          assertReq('PUT', 'http://b.com/pages/1', {foo: 'bar'});
        });
    });

    it ('overwrites layouts when overwrite includes "layouts"', function () {
      mockReq('GET', 'http://a.com/pages/1', {layout: 'a.com/components/a/instances/1'});
      mockReq('GET', 'http://a.com/components/a/instances/1.json', {foo: 'bar'});
      mockReq('GET', 'http://b.com/pages/1', {});
      mockReq('GET', 'http://b.com/components/a/instances/1', {});
      mockReq('PUT', 'http://b.com/components/a/instances/1', 200);
      return fn('http://a.com/pages/1', 'http://b.com', {overwrite: ['layouts']})
        .collect()
        .toPromise(Promise)
        .then(() => {
          assertReq('PUT', 'http://b.com/components/a/instances/1', {foo: 'bar'});
        });
    });

    it ('overwrite components if overwrite includes "components"', function () {
      mockReq('GET', 'http://a.com/components/instances/1.json', {foo: 'bar'});
      mockReq('PUT', 'http://b.com/components/instances/1', 200);
      return fn('http://a.com/components/instances/1', 'http://b.com', {overwrite: ['components']})
        .collect()
        .toPromise(Promise)
        .then(() => {
          assertReq('PUT', 'http://b.com/components/instances/1', {foo: 'bar'});
        });
    });
  });


  describe('importPages', function () {
    const fn = lib[this.title];

    it ('imports each page of Site A into Site B', function () {
      mockPagesIndex(false, false);
      mockReq('GET', 'http://a.com/pages/0', {foo: 'bar'});
      mockReq('GET', 'http://a.com/pages/1', {baz: 'zar'});
      mockReq('GET', 'http://b.com/pages/0', 404);
      mockReq('GET', 'http://b.com/pages/1', 404);
      mockReq('PUT', 'http://b.com/pages/0', 200);
      mockReq('PUT', 'http://b.com/pages/1', 200);
      return fn('http://a.com', 'http://b.com')
        .collect()
        .toPromise(Promise)
        .then(() => {
          assertReq('PUT', 'http://b.com/pages/0', {foo: 'bar'});
          assertReq('PUT', 'http://b.com/pages/1', {baz: 'zar'});
        });
    });

    it ('overwrites pages if overwrite includes "pages"', function () {
      mockPagesIndex(false, false);
      mockReq('GET', 'http://a.com/pages/0', {foo: 'bar'});
      mockReq('GET', 'http://a.com/pages/1', {baz: 'zar'});
      mockReq('GET', 'http://b.com/pages/0', {});
      mockReq('GET', 'http://b.com/pages/1', {});
      mockReq('PUT', 'http://b.com/pages/0', {});
      mockReq('PUT', 'http://b.com/pages/1', {});

      return fn('http://a.com', 'http://b.com', {overwrite: ['pages']})
        .collect()
        .toPromise(Promise)
        .then(() => {
          assertReq('PUT', 'http://b.com/pages/0', {foo: 'bar'});
          assertReq('PUT', 'http://b.com/pages/1', {baz: 'zar'});
        });
    });

    it ('does not PUT to the same component twice', function () {

      // Site A pages
      mockPagesIndex(false, false);
      mockReq('GET', 'http://a.com/pages/0', {foo: ['a.com/components/c/0']});
      mockReq('GET', 'http://a.com/pages/1', {foo: ['a.com/components/c/0']});
      mockReq('GET', 'http://a.com/components/c/0.json', {baz: 'zar'});

      // Site B pages
      mockReq('GET', 'http://b.com/pages/0', 404);
      mockReq('GET', 'http://b.com/pages/1', 404);
      mockReq('GET', 'http://b.com/components/c/0', 404);

      // PUTs
      mockReq('PUT', 'http://b.com/pages/0', 200);
      mockReq('PUT', 'http://b.com/pages/1', 200);
      mockReq('PUT', 'http://b.com/components/c/0', 200);

      return fn('http://a.com', 'http://b.com')
        .collect()
        .toPromise(Promise)
        .then(() => {
          matchReq('PUT', 'http://b.com/components/c/0').length === 1;
        });
    });

    it ('imports both drafts and published pages if "published" is set', function () {
      mockPagesIndex(true, true);

      // Site A pages
      mockReq('GET', 'http://a.com/pages/0', {foo: 'bar'});
      mockReq('GET', 'http://a.com/pages/1', {baz: 'zar'});
      mockReq('GET', 'http://a.com/pages/0@published', {har: 'lar'});
      mockReq('GET', 'http://a.com/pages/1@published', {kar: 'mar'});

      // Site B pages
      mockReq('GET', 'http://b.com/pages/0', 404);
      mockReq('GET', 'http://b.com/pages/1', 404);
      mockReq('GET', 'http://b.com/pages/0@published', 404);
      mockReq('GET', 'http://b.com/pages/1@published', 404);

      // PUTs
      mockReq('PUT', 'http://b.com/pages/0', 200);
      mockReq('PUT', 'http://b.com/pages/1', 200);
      mockReq('PUT', 'http://b.com/pages/0@published', 200);
      mockReq('PUT', 'http://b.com/pages/1@published', 200);

      return fn('http://a.com', 'http://b.com', {published: true})
        .collect()
        .toPromise(Promise)
        .then(() => {
          assertReq('PUT', 'http://b.com/pages/0', {foo: 'bar'});
          assertReq('PUT', 'http://b.com/pages/1', {baz: 'zar'});
          assertReq('PUT', 'http://b.com/pages/0@published', {har: 'lar'});
          assertReq('PUT', 'http://b.com/pages/1@published', {kar: 'mar'});
        });
    });
  });

});

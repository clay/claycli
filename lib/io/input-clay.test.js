const h = require('highland'),
  b64 = require('base-64'),
  rest = require('../utils/rest'),
  config = require('../utils/config'),
  lib = require('./input-clay'),
  {assertItems} = require('../../test/test-util');

function createError(url) {
  const err = new Error('Not Found');

  err.url = url;
  return err;
}

describe('input clay', () => {
  let sandbox;

  beforeEach(() => {
    sandbox = sinon.sandbox.create();
    sandbox.stub(rest);
    sandbox.stub(config, 'normalizeSite').callsFake((uri) => `http://${uri}`);
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('getComponentInstances', () => {
    const fn = lib.getComponentInstances;

    it('fetches component instances', (done) => {
      rest.get.returns(h(['one']));
      fn('domain.com', 'foo').collect().toCallback((err, data) => {
        expect(data).to.eql(['one']);
        expect(rest.get).to.have.been.calledWith('domain.com/components/foo/instances');
        done(err);
      });
    });

    it('fetches published component instances', (done) => {
      rest.get.returns(h(['one']));
      fn('domain.com', 'foo', {concurrency: 1, headers: {headerKey: 'headerVal'}, onlyPublished: true}).collect().toCallback((err, data) => {
        expect(data).to.eql(['one']);
        expect(rest.get).to.have.been.calledWith('domain.com/components/foo/instances/@published', {concurrency: 1, headers: {headerKey: 'headerVal'}});
        done(err);
      });
    });
  });

  describe('listComponentReferences', () => {
    const fn = lib.listComponentReferences;

    it('returns empty array if no references', () => {
      expect(fn({ a: 'b' })).to.eql([]);
    });

    it('returns references from component lists', () => {
      expect(fn({ a: [{ _ref: 'foo' }] })).to.eql(['foo']);
    });

    it('returns references from component props', () => {
      expect(fn({ a: { _ref: 'foo' }, b: { c: 'd' } })).to.eql(['foo']);
    });

    it('does not return references from page data', () => {
      expect(fn({
        layout: 'domain.com/components/foo',
        main: ['domain.com/components/bar']
      })).to.eql([]);
    });
  });

  describe('checkAllReferences', () => {
    const fn = lib.checkAllReferences,
      fooUri = 'domain.com/components/foo',
      fooUrl = `http://${fooUri}`,
      barUri = 'domain.com/components/bar',
      barUrl = `http://${barUri}`,
      bazUri = 'domain.com/components/baz',
      bazUrl = `http://${bazUri}`,
      pageUri = 'domain.com/pages/foo',
      pageUrl = `http://${pageUri}`,
      publicUri = 'domain.com/some-slug',
      b64publicUri = b64.encode(publicUri),
      uriUrl = `http://domain.com/uris/${b64publicUri}`;

    it('checks a component with no refs (404)', (done) => {
      rest.get.returns(h.fromError(createError(fooUrl)));
      fn(fooUri).collect().toCallback((err, data) => {
        expect(data).to.eql([{ status: 'error', url: fooUrl, message: 'Not Found' }]);
        done(err);
      });
    });

    it('checks a component with no refs (200)', (done) => {
      rest.get.returns(h([{ a: 'b' }]));
      fn(fooUri).collect().toCallback((err, data) => {
        expect(data).to.eql([{ status: 'success' }]);
        done(err);
      });
    });

    it('checks a component with refs (404)', (done) => {
      rest.get.withArgs(fooUrl).returns(h([{ a: { _ref: barUri }}]));
      rest.get.withArgs(barUrl).returns(h.fromError(createError(barUrl)));
      fn(fooUri).collect().toCallback((err, data) => {
        expect(data).to.eql([{ status: 'success' }, { status: 'error', url: barUrl, message: 'Not Found' }]);
        done(err);
      });
    });

    it('checks a component with refs (200)', (done) => {
      rest.get.withArgs(fooUrl).returns(h([{ a: { _ref: barUri }}]));
      rest.get.withArgs(barUrl).returns(h([{ a: 'b' }]));
      fn(fooUri).collect().toCallback((err, data) => {
        expect(data).to.eql([{ status: 'success' }, { status: 'success' }]);
        done(err);
      });
    });

    it('checks a component with deep refs (404)', (done) => {
      rest.get.withArgs(fooUrl).returns(h([{ a: { _ref: barUri }}]));
      rest.get.withArgs([barUrl]).returns(h([{ a: { _ref: bazUri }}]));
      rest.get.withArgs([bazUrl]).returns(h.fromError(createError(bazUrl)));
      fn(fooUri, true).collect().toCallback((err, data) => {
        expect(data).to.eql([{ status: 'success' }, { status: 'success' }, { status: 'error', url: bazUrl, message: 'Not Found' }]);
        done(err);
      });
    });

    it('checks a component with deep refs (200)', (done) => {
      rest.get.withArgs(fooUrl).returns(h([{ a: { _ref: barUri }}]));
      rest.get.withArgs([barUrl]).returns(h([{ a: { _ref: bazUri }}]));
      rest.get.withArgs([bazUrl]).returns(h([{ a: 'b' }]));
      fn(fooUri, true).collect().toCallback((err, data) => {
        expect(data).to.eql([{ status: 'success' }, { status: 'success' }, { status: 'success' }]);
        done(err);
      });
    });

    it('checks a page that 404s', (done) => {
      rest.get.returns(h.fromError(createError(pageUrl)));
      fn(pageUri).collect().toCallback((err, data) => {
        expect(data).to.eql([{ status: 'error', url: pageUrl, message: 'Not Found' }]);
        done(err);
      });
    });

    it('checks a page with component that 404s', (done) => {
      rest.get.withArgs(pageUrl).returns(h([{
        layout: fooUri,
        main: [barUri]
      }]));
      rest.get.withArgs(fooUrl).returns(h([{ a: 'b' }]));
      rest.get.withArgs(barUrl).returns(h.fromError(createError(barUrl)));
      fn(pageUri).collect().toCallback((err, data) => {
        expect(data).to.eql([{ status: 'success' }, { status: 'success' }, { status: 'error', url: barUrl, message: 'Not Found' }]);
        done(err);
      });
    });

    it('checks a page with components that 200', (done) => {
      rest.get.withArgs(pageUrl).returns(h([{
        layout: fooUri,
        main: [barUri]
      }]));
      rest.get.withArgs(fooUrl).returns(h([{ a: 'b' }]));
      rest.get.withArgs(barUrl).returns(h([{ a: 'b' }]));
      fn(pageUri).collect().toCallback((err, data) => {
        expect(data).to.eql([{ status: 'success' }, { status: 'success' }, { status: 'success' }]);
        done(err);
      });
    });

    it('checks a page with deep components that 404', (done) => {
      rest.get.withArgs(pageUrl).returns(h([{
        layout: fooUri,
        main: [barUri]
      }]));
      rest.get.withArgs([fooUrl]).returns(h([{ a: 'b' }]));
      rest.get.withArgs([barUrl]).returns(h([{ a: { _ref: bazUri }}]));
      rest.get.withArgs([bazUrl]).returns(h.fromError(createError(bazUrl)));
      fn(pageUri, true).collect().toCallback((err, data) => {
        expect(data).to.eql([{ status: 'success' }, { status: 'success' }, { status: 'success' }, { status: 'error', url: bazUrl, message: 'Not Found' }]);
        done(err);
      });
    });

    it('checks a page with deep components that 200', (done) => {
      rest.get.withArgs(pageUrl).returns(h([{
        layout: fooUri,
        main: [barUri]
      }]));
      rest.get.withArgs([fooUrl]).returns(h([{ a: 'b' }]));
      rest.get.withArgs([barUrl]).returns(h([{ a: { _ref: bazUri }}]));
      rest.get.withArgs([bazUrl]).returns(h([{ a: 'b' }]));
      fn(pageUri, true).collect().toCallback((err, data) => {
        expect(data).to.eql([{ status: 'success' }, { status: 'success' }, { status: 'success' }, { status: 'success' }]);
        done(err);
      });
    });

    it('emits error when checking public url without prefix', (done) => {
      fn(publicUri).collect().toCallback((err) => {
        expect(err.message).to.eql('Site prefix is required to check public urls!');
        done();
      });
    });

    it('checks a public url that 404s', (done) => {
      rest.get.withArgs(uriUrl).returns(h.fromError(createError(uriUrl)));
      fn(publicUri, false, 'http://domain.com').collect().toCallback((err, data) => {
        expect(data).to.eql([{ status: 'error', url: uriUrl, message: 'Not Found' }]);
        done(err);
      });
    });

    it('checks a public url with a page that 404s', (done) => {
      rest.get.withArgs(uriUrl).returns(h([pageUri]));
      rest.get.withArgs(pageUrl).returns(h.fromError(createError(pageUrl)));
      fn(publicUri, false, 'http://domain.com').collect().toCallback((err, data) => {
        expect(data).to.eql([{ status: 'error', url: pageUrl, message: 'Not Found'}]);
        done(err);
      });
    });

    it('checks a public url with a page that 200s', (done) => {
      rest.get.withArgs(uriUrl).returns(h([pageUri]));
      rest.get.withArgs(pageUrl).returns(h([{
        layout: fooUri,
        main: [barUri]
      }]));
      rest.get.withArgs(fooUrl).returns(h([{ a: 'b' }]));
      rest.get.withArgs(barUrl).returns(h([{ a: 'b' }]));
      fn(publicUri, false, 'http://domain.com').collect().toCallback((err, data) => {
        expect(data).to.eql([{ status: 'success' }, { status: 'success' }, { status: 'success' }]);
        done(err);
      });
    });
  });

  describe('importUrl', () => {
    const fn = lib.importUrl,
      fooUri = 'domain.com/components/foo',
      fooUrl = `http://${fooUri}`,
      fooJSON = `${fooUrl}.json`,
      barUri = 'domain.com/components/bar',
      barUrl = `http://${barUri}`,
      barJSON = `${barUrl}.json`,
      pageUri = 'domain.com/pages/foo',
      pageUrl = `http://${pageUri}`;

    it('imports single component', (done) => {
      rest.get.withArgs(fooJSON).returns(h([JSON.stringify({ a: 'b' })]));
      fn(fooUrl, 10).collect().toCallback((err, data) => {
        expect(data).to.eql([{ url: fooUrl, data: JSON.stringify({ a: 'b' }) }]);
        done(err);
      });
    });

    it('imports single page', (done) => {
      rest.get.withArgs(pageUrl).returns(h([{ layout: fooUri, a: [barUri] }]));
      fn(pageUrl, 10).collect().toCallback((err, data) => {
        assertItems(data, [{
          url: pageUrl,
          data: {
            layout: fooUri,
            a: [barUri]
          }
        }, {
          url: fooUrl,
          isLayout: true
        }, {
          url: barUrl
        }]);
        done(err);
      });
    });

    it('emits error if passed something other than page or component', (done) => {
      fn('domain.com/2019/01/some-slug', 10).collect().toCallback((err) => {
        expect(err.message).to.eql('Unable to GET domain.com/2019/01/some-slug: Not a page or component!');
        done();
      });
    });
  });

  describe('getPagesInSite', () => {
    const fn = lib.getPagesInSite,
      site = 'http://domain.com',
      mockKey = 'foo',
      mockElasticResults = {
        data: {
          hits: {
            hits: [
              {_source: {foo: 1}},
              {_source: {foo: 2}},
              {_source: {foo: 3}}
            ]
          }
        }
      };

    beforeEach(()=> {
      rest.post.returns(h([mockElasticResults]));
    });

    it ("searches the specified site's pages endpoint", () => {
      return fn(site).collect().toPromise(Promise).then(() => {
        expect(rest.post.firstCall.args[0].url).to.equal('http://domain.com/_search');
      });
    });

    it ('passes key in POST request', () => {
      return fn(site, {key: mockKey}).collect().toPromise(Promise).then(() => {
        expect(rest.post.firstCall.args[1].key).to.equal(mockKey);
      });
    });

    it ('derives query prefix from site', () => {
      return fn(site).collect().toPromise(Promise).then(() => {
        expect(rest.post.firstCall.args[0].data.body.query.prefix.uri).to.equal('domain.com');
      });
    });

    it ('derives "from" Elastic property from "offset" option', () => {
      return fn(site, {offset: 5}).collect().toPromise(Promise).then(() => {
        expect(rest.post.firstCall.args[0].data.from).to.equal(5);
      });
    });

    it ('derives "size" Elastic property from "limit" option', () => {
      return fn(site, {limit: 5}).collect().toPromise(Promise).then(() => {
        expect(rest.post.firstCall.args[0].data.size).to.equal(5);
      });
    });

    it ('queries only for the "uri" and "published" props', () => {
      return fn(site).collect().toPromise(Promise).then(() => {
        expect(rest.post.firstCall.args[0].data._source).to.eql(['uri', 'published']);
      });
    });

    it ('returns a stream of page objects directly', () => {
      return fn(site).collect().toPromise(Promise).then((results) => {
        expect(results).to.deep.eql([{foo: 1}, {foo: 2}, {foo: 3}]);
      });
    });
  });

});

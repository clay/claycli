const h = require('highland'),
  b64 = require('base-64'),
  rest = require('../utils/rest'),
  config = require('../utils/config'),
  lib = require('./input-clay');

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
        expect(data).to.eql([{ result: 'error', url: fooUrl }]);
        done(err);
      });
    });

    it('checks a component with no refs (200)', (done) => {
      rest.get.returns(h([{ a: 'b' }]));
      fn(fooUri).collect().toCallback((err, data) => {
        expect(data).to.eql([{ result: 'success' }]);
        done(err);
      });
    });

    it('checks a component with refs (404)', (done) => {
      rest.get.withArgs(fooUrl).returns(h([{ a: { _ref: barUri }}]));
      rest.get.withArgs(barUrl).returns(h.fromError(createError(barUrl)));
      fn(fooUri).collect().toCallback((err, data) => {
        expect(data).to.eql([{ result: 'success' }, { result: 'error', url: barUrl }]);
        done(err);
      });
    });

    it('checks a component with refs (200)', (done) => {
      rest.get.withArgs(fooUrl).returns(h([{ a: { _ref: barUri }}]));
      rest.get.withArgs(barUrl).returns(h([{ a: 'b' }]));
      fn(fooUri).collect().toCallback((err, data) => {
        expect(data).to.eql([{ result: 'success' }, { result: 'success' }]);
        done(err);
      });
    });

    it('checks a component with deep refs (404)', (done) => {
      rest.get.withArgs(fooUrl).returns(h([{ a: { _ref: barUri }}]));
      rest.get.withArgs([barUrl]).returns(h([{ a: { _ref: bazUri }}]));
      rest.get.withArgs([bazUrl]).returns(h.fromError(createError(bazUrl)));
      fn(fooUri, true).collect().toCallback((err, data) => {
        expect(data).to.eql([{ result: 'success' }, { result: 'success' }, { result: 'error', url: bazUrl }]);
        done(err);
      });
    });

    it('checks a component with deep refs (200)', (done) => {
      rest.get.withArgs(fooUrl).returns(h([{ a: { _ref: barUri }}]));
      rest.get.withArgs([barUrl]).returns(h([{ a: { _ref: bazUri }}]));
      rest.get.withArgs([bazUrl]).returns(h([{ a: 'b' }]));
      fn(fooUri, true).collect().toCallback((err, data) => {
        expect(data).to.eql([{ result: 'success' }, { result: 'success' }, { result: 'success' }]);
        done(err);
      });
    });

    it('checks a page that 404s', (done) => {
      rest.get.returns(h.fromError(createError(pageUrl)));
      fn(pageUri).collect().toCallback((err, data) => {
        expect(data).to.eql([{ result: 'error', url: pageUrl }]);
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
        expect(data).to.eql([{ result: 'success' }, { result: 'success' }, { result: 'error', url: barUrl }]);
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
        expect(data).to.eql([{ result: 'success' }, { result: 'success' }, { result: 'success' }]);
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
        expect(data).to.eql([{ result: 'success' }, { result: 'success' }, { result: 'success' }, { result: 'error', url: bazUrl }]);
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
        expect(data).to.eql([{ result: 'success' }, { result: 'success' }, { result: 'success' }, { result: 'success' }]);
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
        expect(data).to.eql([{ result: 'error', url: uriUrl }]);
        done(err);
      });
    });

    it('checks a public url with a page that 404s', (done) => {
      rest.get.withArgs(uriUrl).returns(h([pageUri]));
      rest.get.withArgs(pageUrl).returns(h.fromError(createError(pageUrl)));
      fn(publicUri, false, 'http://domain.com').collect().toCallback((err, data) => {
        expect(data).to.eql([{ result: 'error', url: pageUrl }]);
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
        expect(data).to.eql([{ result: 'success' }, { result: 'success' }, { result: 'success' }]);
        done(err);
      });
    });
  });
});

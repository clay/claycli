const h = require('highland'),
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
    const fn = lib.checkAllReferences;

    it('checks a component with no refs (404)', (done) => {
      rest.get.returns(h.fromError(createError('http://foo')));
      fn('foo').collect().toCallback((err, data) => {
        expect(data).to.eql([{ result: 'error', url: 'http://foo' }]);
        done(err);
      });
    });

    it('checks a component with no refs (200)', (done) => {
      rest.get.returns(h([{ a: 'b' }]));
      fn('foo').collect().toCallback((err, data) => {
        expect(data).to.eql([{ result: 'success' }]);
        done(err);
      });
    });

    it('checks a component with refs (404)', (done) => {
      rest.get.withArgs('http://foo').returns(h([{ a: { _ref: 'bar' }}]));
      rest.get.withArgs('http://bar').returns(h.fromError(createError('http://bar')));
      fn('foo').collect().toCallback((err, data) => {
        expect(data).to.eql([{ result: 'success' }, { result: 'error', url: 'http://bar' }]);
        done(err);
      });
    });

    it('checks a component with refs (200)', (done) => {
      rest.get.withArgs('http://foo').returns(h([{ a: { _ref: 'bar' }}]));
      rest.get.withArgs('http://bar').returns(h([{ a: 'b' }]));
      fn('foo').collect().toCallback((err, data) => {
        expect(data).to.eql([{ result: 'success' }, { result: 'success' }]);
        done(err);
      });
    });

    it('checks a component with deep refs (404)', (done) => {
      rest.get.withArgs('http://foo').returns(h([{ a: { _ref: 'bar' }}]));
      rest.get.withArgs(['http://bar']).returns(h([{ a: { _ref: 'baz' }}]));
      rest.get.withArgs(['http://baz']).returns(h.fromError(createError('http://baz')));
      fn('foo', true).collect().toCallback((err, data) => {
        expect(data).to.eql([{ result: 'success' }, { result: 'success' }, { result: 'error', url: 'http://baz' }]);
        done(err);
      });
    });

    it('checks a component with deep refs (200)', (done) => {
      rest.get.withArgs('http://foo').returns(h([{ a: { _ref: 'bar' }}]));
      rest.get.withArgs(['http://bar']).returns(h([{ a: { _ref: 'baz' }}]));
      rest.get.withArgs(['http://baz']).returns(h([{ a: 'b' }]));
      fn('foo', true).collect().toCallback((err, data) => {
        expect(data).to.eql([{ result: 'success' }, { result: 'success' }, { result: 'success' }]);
        done(err);
      });
    });
  });
});

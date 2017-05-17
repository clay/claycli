const lib = require('./config'),
  config = require('home-config');

describe('rest', () => {
  let sandbox;

  beforeEach(() => {
    sandbox = sinon.sandbox.create();
    sandbox.stub(config, 'load');
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('get', () => {
    const fn = lib.get;

    it('throws error if unknown section', () => {
      config.load.returns({});
      expect(() => fn('foo.bar')).to.throw('Cannot get foo.bar: Unknown section "foo"');
    });

    it('returns null if undefined value', () => {
      config.load.returns({ key: {} });
      expect(fn('key.foo')).to.equal(null);
    });

    it('gets keys', () => {
      config.load.returns({ key: { foo: 'bar' }});
      expect(fn('key.foo')).to.equal('bar');
    });

    it('gets sites', () => {
      config.load.returns({ site: { foo: 'bar' }});
      expect(fn('site.foo')).to.equal('bar');
    });
  });

  describe('set', () => {
    const fn = lib.set;

    it('throws error if unknown section', () => {
      config.load.returns({});
      expect(() => fn('foo.bar')).to.throw('Cannot save foo.bar: Unknown section "foo"');
    });

    it('saves keys', () => {
      config.load.returns({ key: {}, save: sandbox.spy() });
      fn('key.foo', 'bar');
      expect(config.load().save).to.have.been.called;
    });

    it('saves sites', () => {
      config.load.returns({ site: {}, save: sandbox.spy() });
      fn('site.foo', 'bar');
      expect(config.load().save).to.have.been.called;
    });
  });
});

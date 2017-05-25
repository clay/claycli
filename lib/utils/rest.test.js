const h = require('highland'),
  lib = require('./rest'),
  fetch = require('./fetch'),
  logger = require('./logger'),
  url = 'http://domain.com/test';

describe('rest', () => {
  let sandbox;

  before(() => {
    logger.init(false); // don't log debug
  });

  beforeEach(() => {
    sandbox = sinon.sandbox.create();
    sandbox.stub(fetch, 'send');
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('get', () => {
    const fn = lib.get;

    // catchError and checkStatus tests are here, but are not repeated in the getText, put, putText etc methods
    it('catches on rejection', (done) => {
      fetch.send.returns(Promise.reject(new Error('nope')));
      fn(url).stopOnError((err) => {
        expect(err.message).to.equal('nope');
      }).done(done);
    });

    it('catches on auth redirect', (done) => {
      fetch.send.returns(Promise.resolve({ url: 'some-other-domain.com' }));
      fn(url).stopOnError((err) => {
        expect(err.message).to.equal('Not Authorized');
      }).done(done);
    });

    it('catches on 404 errors', (done) => {
      fetch.send.returns(Promise.resolve({ status: 404, statusText: 'Not Found' }));
      fn(url).stopOnError((err) => {
        expect(err.message).to.equal('Not Found');
      }).done(done);
    });

    it('catches on 500 errors', (done) => {
      fetch.send.returns(Promise.resolve({ status: 500, statusText: 'Server Error' }));
      fn(url).stopOnError((err) => {
        expect(err.message).to.equal('Server Error');
      }).done(done);
    });

    it('gets json from url', (done) => {
      fetch.send.returns(Promise.resolve({ url, status: 200, json: () => ({ a: 'b' })}));
      fn(url).collect().toCallback((err, data) => {
        expect(data).to.eql([{ a: 'b' }]);
        expect(fetch.send).to.have.been.calledWith(url);
        done(err);
      });
    });

    it('gets json from array of urls', (done) => {
      fetch.send.returns(Promise.resolve({ url, status: 200, json: () => ({ a: 'b' })}));
      fn(['one', 'two']).collect().toCallback((err, data) => {
        expect(data).to.eql([{ a: 'b' }, { a: 'b' }]);
        expect(fetch.send).to.have.been.calledWith('one');
        expect(fetch.send).to.have.been.calledWith('two');
        done(err);
      });
    });

    it('gets json from stream of urls', (done) => {
      fetch.send.returns(Promise.resolve({ url, status: 200, json: () => ({ a: 'b' })}));
      fn(h(['one', 'two'])).collect().toCallback((err, data) => {
        expect(data).to.eql([{ a: 'b' }, { a: 'b' }]);
        expect(fetch.send).to.have.been.calledWith('one');
        expect(fetch.send).to.have.been.calledWith('two');
        done(err);
      });
    });
  });

  describe('put', () => {
    const fn = lib.put;

    it('puts json to url', (done) => {
      fetch.send.returns(Promise.resolve({ url, status: 200, json: () => ({ a: 'b' })}));
      fn({ [url]: { a: 'b' } }).collect().toCallback((err, data) => {
        expect(data).to.eql([{ a: 'b' }]);
        expect(fetch.send).to.have.been.calledWith(url);
        done(err);
      });
    });

    it('puts json to array of urls', (done) => {
      fetch.send.returns(Promise.resolve({ url, status: 200, json: () => ({ a: 'b' })}));
      fn([{one: { a: 'b' }}, {two: { a: 'b' }}]).collect().toCallback((err, data) => {
        expect(data).to.eql([{ a: 'b' }, { a: 'b' }]);
        expect(fetch.send).to.have.been.calledWith('one');
        expect(fetch.send).to.have.been.calledWith('two');
        done(err);
      });
    });

    it('puts json to stream of urls', (done) => {
      fetch.send.returns(Promise.resolve({ url, status: 200, json: () => ({ a: 'b' })}));
      fn(h([{one: { a: 'b' }}, {two: { a: 'b' }}])).collect().toCallback((err, data) => {
        expect(data).to.eql([{ a: 'b' }, { a: 'b' }]);
        expect(fetch.send).to.have.been.calledWith('one');
        expect(fetch.send).to.have.been.calledWith('two');
        done(err);
      });
    });
  });
});

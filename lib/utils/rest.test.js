'use strict';

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

    it('gets text from url', (done) => {
      fetch.send.returns(Promise.resolve({ url, status: 200, text: () => 'hi'}));
      fn(url, {key: null, type: 'text'}).collect().toCallback((err, data) => {
        expect(data).to.eql(['hi']);
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

    it('gets with headers', (done) => {
      const mockHeaders = {
        headerKey: 'headerVal'
      };

      fetch.send.returns(Promise.resolve({ url, status: 200, json: () => ({ a: 'b' })}));
      fn(url, {concurrency: 1, type: 'json', headers: mockHeaders}).collect().toCallback((err) => {
        expect(fetch.send.getCall(0).calledWith(url, {
          method: 'GET',
          headers: mockHeaders
        }));
        done(err);
      });
    });
  });

  describe('put', () => {
    const fn = lib.put,
      stringData = JSON.stringify({ a: 'b' });

    it('puts stringified json to url', (done) => {
      fetch.send.returns(Promise.resolve({ url, status: 200 }));
      fn({ url, data: stringData }).collect().toCallback((err, data) => {
        expect(data).to.eql([{ result: 'success', url }]);
        expect(fetch.send).to.have.been.calledWith(url);
        done(err);
      });
    });

    it('puts stringified json to array of urls', (done) => {
      fetch.send.returns(Promise.resolve({ url, status: 200 }));
      fn([{url: 'one', data: stringData}, { url: 'two', data: stringData}]).collect().toCallback((err, data) => {
        expect(data).to.eql([{ result: 'success', url: 'one' }, { result: 'success', url: 'two' }]);
        expect(fetch.send).to.have.been.calledWith('one');
        expect(fetch.send).to.have.been.calledWith('two');
        done(err);
      });
    });

    it('puts text to url', (done) => {
      fetch.send.returns(Promise.resolve({ url, status: 200 }));
      fn({ url, data: 'hi'}, {key: null, concurrency: 10, type: 'text'}).collect().toCallback((err, data) => {
        expect(data).to.eql([{ result: 'success', url }]);
        expect(fetch.send).to.have.been.calledWith(url);
        done(err);
      });
    });

    it('returns errors with message if fetch fails', (done) => {
      fetch.send.returns(Promise.reject(new Error('uh oh')));
      fn({ url, data: stringData}).collect().toCallback((err, data) => {
        expect(data).to.eql([{ result: 'error', url, message: 'uh oh'}]);
        done(err);
      });
    });

    it('puts with headers', (done) => {
      const mockHeaders = {
          headerKey: 'headerVal',
          'Content-Type': 'overwriteContentType'
        },
        mockHeadersWithAuth = {
          headerKey: 'headerVal',
          'Content-Type': 'overwriteContentType',
          Authorization: 'Token null'
        };

      fetch.send.returns(Promise.resolve({ url, status: 200 }));
      fn({ url, data: 'hi'}, {concurrency: 10, type: 'text', headers: mockHeaders}).collect().toCallback((err, data) => {
        expect(data).to.eql([{ result: 'success', url }]);
        expect(fetch.send.getCall(0).args).to.deep.equal([
          url,
          {
            method: 'PUT',
            body: 'hi',
            headers: mockHeadersWithAuth
          }
        ]);
        done(err);
      });
    });
  });
});

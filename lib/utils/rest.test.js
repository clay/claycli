const lib = require('./rest'),
  fetch = require('./fetch'),
  url = 'http://domain.com/test';

describe('rest', () => {
  let sandbox;

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
    it('catches on rejection', () => {
      fetch.send.returns(Promise.reject(new Error('nope')));
      return fn(url).catch((error) => {
        expect(error.message).to.equal('nope');
      });
    });

    it('catches on auth redirect', () => {
      fetch.send.returns(Promise.resolve({ url: 'some-other-domain.com' }));
      return fn(url).catch((error) => {
        expect(error.message).to.equal('Not Authorized');
      });
    });

    it('catches on 404 errors', () => {
      fetch.send.returns(Promise.resolve({ status: 404, statusText: 'Not Found' }));
      return fn(url).catch((error) => {
        expect(error.message).to.equal('Not Found');
      });
    });

    it('catches on 500 errors', () => {
      fetch.send.returns(Promise.resolve({ status: 500, statusText: 'Server Error' }));
      return fn(url).catch((error) => {
        expect(error.message).to.equal('Server Error');
      });
    });

    it('gets json', () => {
      fetch.send.returns(Promise.resolve({ url, status: 200, json: () => ({ a: 'b' })}));
      return fn(url).then((res) => {
        expect(res).to.eql({ a: 'b' });
        expect(fetch.send).to.have.been.calledWith(url);
      });
    });
  });

  describe('getText', () => {
    const fn = lib.getText;

    it('gets text', () => {
      fetch.send.returns(Promise.resolve({ url, status: 200, text: () => 'hi' }));
      return fn(url).then((res) => {
        expect(res).to.equal('hi');
        expect(fetch.send).to.have.been.calledWith(url);
      });
    });
  });

  describe('put', () => {
    const fn = lib.put;

    it('puts json', () => {
      fetch.send.returns(Promise.resolve({ url, status: 200, json: () => ({ a: 'b' })}));
      return fn(url, { a: 'b' }).then((res) => {
        expect(res).to.eql({ a: 'b' });
        expect(fetch.send).to.have.been.calledWith(url);
      });
    });
  });

  describe('putText', () => {
    const fn = lib.putText;

    it('puts text', () => {
      fetch.send.returns(Promise.resolve({ url, status: 200, text: () => 'hi'}));
      return fn(url, 'hi').then((res) => {
        expect(res).to.equal('hi');
        expect(fetch.send).to.have.been.calledWith(url);
      });
    });
  });
});

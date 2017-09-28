const lib = require('./import'),
  sinon = require('sinon'),
  fetch = require('../utils/fetch'),
  _ = require('lodash');

/**
* Assert exactly one fetch.send call has been made with the
* specified url, method, and body
* @param {string} url
* @param {string} method
* @param {Object} body
**/
function assertReq(url, method, body) {
  const calls = fetch.send.getCalls(),
    matching = calls.filter(call =>
      call.args[0] === url &&
      call.args[1].method === method);

  body = typeof body === 'object' ? JSON.stringify(body) : body;

  if (matching.length > 1) {
    throw new Error(`expected only one ${method} request to ${url} but found ${matching.length}`);
  }
  if (matching.length === 0) {
    throw new Error(`expected a ${method} request to ${url} but found none`);
  }
  if (body) {
    expect(matching[0].args[1].body).to.eql(body);
  }
}

// Pretend PUTs to these urls work
function okPuts(...urls) {
  urls.forEach((url) => {
    fetch.send.withArgs(url, sinon.match({method: 'PUT'})).returns(Promise.resolve({
      status: 200
    }));
  });
}

/**
* Spoof rest.send to act as if the specified URLs exist and return
* the specified status codes or data.
* @param {Object} urls Mapping URLs to either status code or body (default status is 200)
**/
function spoofGets(urls) {
  _.each(urls, (body, url) => {
    fetch.send.withArgs(`${url}`).returns(Promise.resolve({
      status: typeof body === 'number' ? body : 200,
      json: () => body
    }));
  });
};

require('../utils/logger').init();

describe('import api', () => {
  let sandbox;

  beforeEach(() => {
    sandbox = sinon.sandbox.create();
    sandbox.stub(fetch, 'send');
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('importUrl', function () {
    const fn = lib[this.title];

    it ('imports page', function () {

      spoofGets({
        'http://a.com/pages/1': {lastModified: 'a'}
      });
      okPuts('http://b.com/pages/1');
      return fn('http://a.com/pages/1', 'http://b.com')
        .collect()
        .toPromise(Promise)
        .then(() => {
          assertReq('http://b.com/pages/1', 'PUT', {lastModified: 'a'});
        });
    });

    it ('imports all page components, chaning prefixes through deep cmpt', function () {
      spoofGets({
        'http://a.com/pages/1': {
          main: [
            'a.com/components/a/instances/foo'
          ],
        },
        'http://a.com/components/a/instances/foo.json': {
          foo: 'bar',
          someCmpt: {
            _ref: 'a.com/components/a/instances/bar',
            someCmptList: [{
              _ref: 'a.com/components/a/instances/car'
            }]
          }
        }
      });
      okPuts(
        'http://b.com/pages/1',
        'http://b.com/components/a/instances/foo'
      );
      return fn('http://a.com/pages/1', 'http://b.com')
        .collect()
        .toPromise(Promise)
        .then(() => {
          assertReq('http://b.com/pages/1', 'PUT', {
            main: ['b.com/components/a/instances/foo']
          });
          assertReq('http://b.com/components/a/instances/foo', 'PUT', {
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
      spoofGets({
        'http://a.com/components/a/instances/1.json': {
          foo: 'bar'
        }
      });

      okPuts('http://b.com/components/a/instances/1');

      return fn('http://a.com/components/a/instances/1', 'http://b.com')
        .collect()
        .toPromise(Promise)
        .then(() => {
          assertReq('http://b.com/components/a/instances/1', 'PUT', {
            foo: 'bar'
          });
        });
    });

    it ('imports a list into a target site', function () {
      spoofGets({
        'http://a.com/lists/a': ['a', 'b', 'c'],
        'http://b.com/lists/a': 404
      });
      okPuts('http://b.com/lists/a');
      return fn('http://a.com/lists/a', 'http://b.com')
        .collect()
        .toPromise(Promise)
        .then(() => {
          assertReq('http://b.com/lists/a', 'PUT', ['a','b','c']);
        });
    });

    it ('merge with existing lists', function () {
      spoofGets({
        'http://a.com/lists/a': ['a', 'b', 'c'],
        'http://b.com/lists/a': ['b', 'c', 'd']
      });
      okPuts('http://b.com/lists/a');
      return fn('http://a.com/lists/a', 'http://b.com')
        .collect()
        .toPromise(Promise)
        .then(() => {
          assertReq('http://b.com/lists/a', 'PUT', ['a','b','c','d']);
        });
    });

  });
});

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
    fetch.send.withArgs(url).returns(Promise.resolve({
      status: 200
    }));
  });
}

/**
* Spoof rest.send to act as if a site exists at the specified prefix with
* the specified assets
* @param {string} prefix
* @param {Object} assets e.g. {'/pages/a': {lastModified: 1}, '/components/a/instances/b': {foo: 'bar'}}
**/
function spoofSite(prefix, assets) {
  _.each(assets, (value, key) => {
    fetch.send.withArgs(`${prefix}${key}`).returns(Promise.resolve({
      status: 200,
      json: () => value
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

      spoofSite('http://a.com', {
        '/pages/1': {lastModified: 'a'}
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
      spoofSite('http://a.com', {
        '/pages/1': {
          main: [
            'a.com/components/a/instances/foo'
          ],
        },
        '/components/a/instances/foo.json': {
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
      spoofSite('http://a.com', {
        '/components/a/instances/1.json': {
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
      spoofSite('http://a.com', {
        '/lists/a': ['a', 'b', 'c']
      });
    });

  });
});

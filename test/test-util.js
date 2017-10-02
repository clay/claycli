const fetch = require('../lib/utils/fetch');

/**
* Assert exactly one fetch.send call has been made with the
* specified url, method, and body
* @param {string} method
* @param {string} url
* @param {Object|number} body
**/
function assertReq(method, url, body) {
  const matching = matchReq(method, url);

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

/**
* Return all the fetch.send calls that match the specified method, url, and (optionally) body.
* @param {string} method
* @param {string} url
* @param {Object} [body]
* @return {Object[]}
**/
function matchReq(method, url, body) {
  if (!fetch.send.getCalls) {
    throw new Error('You must stub fetch.send before using matchReq');
  }
  return fetch.send.getCalls()
    .filter(call =>
      call.args[0] === url &&
      call.args[1].method === method &&
      (body ? call.args[1].body === body : true));
}

/**
* Mock a request to the specified url with the specified method,
* resolving with the specified body or status code.
* @param {string} method
* @param {string} url
* @param {number|Object} body
**/
function mockReq(method, url, body) {
  if (!fetch.send.withArgs) {
    throw new Error('You must stub fetch.send before using mockReq');
  }
  fetch.send.withArgs(url, sinon.match({method})).returns(Promise.resolve({
    status: typeof body === 'number' ? body : 200,
    json: typeof body === 'object' ? () => body : undefined
  }));
}

module.exports.assertReq = assertReq;
module.exports.matchReq = matchReq;
module.exports.mockReq = mockReq;

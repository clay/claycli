/* global fetch:false */

'use strict';
const lib = require('./rest'),
  url = 'http://domain.com/foo',
  url2 = 'https://domain.com/bar';

describe('rest', () => {
  afterEach(() => {
    fetch.resetMocks();
  });

  // --- Tests for Promise-based (async) API ---

  it('returns Error object with url on network rejection', () => {
    fetch.mockRejectOnce(new Error('nope'));
    return lib.getAsync(url).then((res) => {
      expect(res).toBeInstanceOf(Error);
      expect(res.message).toBe('nope');
      expect(res.url).toBe(url);
    });
  });

  it('returns Error object on auth redirect', () => {
    fetch.mockResponseOnce('{}', { status: 401 });
    return lib.getAsync(url).then((res) => {
      expect(res).toBeInstanceOf(Error);
      expect(res.message).toBe('Unauthorized');
      expect(res.url).toBe(url);
    });
  });

  it('returns Error object on client errors', () => {
    fetch.mockResponseOnce('{}', { status: 400 });
    return lib.getAsync(url).then((res) => {
      expect(res).toBeInstanceOf(Error);
      expect(res.message).toBe('Bad Request');
      expect(res.url).toBe(url);
    });
  });

  it('returns Error object on server errors', () => {
    fetch.mockResponseOnce('{}', { status: 500 });
    return lib.getAsync(url).then((res) => {
      expect(res).toBeInstanceOf(Error);
      expect(res.message).toBe('Internal Server Error');
      expect(res.url).toBe(url);
    });
  });

  describe('getAsync', () => {
    it('gets json', () => {
      fetch.mockResponseOnce(JSON.stringify({ a: 'b' }));
      return lib.getAsync(url).then((res) => {
        expect(res).toEqual({ a: 'b' });
      });
    });

    it('gets text', () => {
      fetch.mockResponseOnce('hi');
      return lib.getAsync(url, { type: 'text' }).then((res) => {
        expect(res).toBe('hi');
      });
    });

    it('uses https agent for ssl calls', () => {
      fetch.mockResponseOnce(JSON.stringify({ a: 'b' }));
      return lib.getAsync(url2).then(() => {
        expect(fetch.mock.calls[0][1].agent).not.toBeNull();
      });
    });

    it('passes null agent for non-ssl urls', () => {
      fetch.mockResponseOnce(JSON.stringify({ a: 'b' }));
      return lib.getAsync(url).then(() => {
        expect(fetch.mock.calls[0][1].agent).toBeNull();
      });
    });

    it('uses headers', () => {
      fetch.mockResponseOnce(JSON.stringify({ a: 'b' }));
      return lib.getAsync(url, { headers: { Authorization: 'Token abc' }}).then(() => {
        expect(fetch.mock.calls[0][1].headers).toEqual({ Authorization: 'Token abc' });
      });
    });
  });

  describe('putAsync', () => {
    const key = 'some api key',
      json = { a: 'b' },
      jsonString = JSON.stringify(json);

    it('throws error if no api key specified', () => {
      expect(() => lib.putAsync(url, json)).toThrow('Please specify API key to do PUT requests against Clay!');
    });

    it('sends json', () => {
      fetch.mockResponseOnce(json);
      return lib.putAsync(url, json, { key }).then((res) => {
        expect(res).toEqual({ type: 'success', message: url });
        expect(fetch).toHaveBeenCalledWith(url, {
          method: 'PUT',
          agent: null,
          body: jsonString,
          headers: {
            Authorization: `Token ${key}`,
            'Content-Type': 'application/json; charset=UTF-8'
          }
        });
      });
    });

    it('sends json with empty body', () => {
      fetch.mockResponseOnce(json);
      return lib.putAsync(url, null, { key }).then((res) => {
        expect(res).toEqual({ type: 'success', message: url });
        expect(fetch).toHaveBeenCalledWith(url, {
          method: 'PUT',
          agent: null,
          body: undefined,
          headers: {
            Authorization: `Token ${key}`,
            'Content-Type': 'application/json; charset=UTF-8'
          }
        });
      });
    });

    it('sends text', () => {
      fetch.mockResponseOnce('hi');
      return lib.putAsync(url, 'hi', { type: 'text', key }).then((res) => {
        expect(res).toEqual({ type: 'success', message: url });
        expect(fetch).toHaveBeenCalledWith(url, {
          method: 'PUT',
          agent: null,
          body: 'hi',
          headers: {
            Authorization: `Token ${key}`,
            'Content-Type': 'text/plain; charset=UTF-8'
          }
        });
      });
    });

    it('uses https agent for ssl calls', () => {
      fetch.mockResponseOnce(json);
      return lib.putAsync(url2, json, { key }).then(() => {
        expect(fetch.mock.calls[0][1].agent).not.toBeNull();
      });
    });

    it('uses headers', () => {
      fetch.mockResponseOnce(json);
      return lib.putAsync(url, json, { key, headers: { some_header: 'value' }}).then(() => {
        expect(fetch.mock.calls[0][1].headers).toEqual({
          Authorization: `Token ${key}`,
          'Content-Type': 'application/json; charset=UTF-8',
          some_header: 'value'
        });
      });
    });

    it('returns error result if PUT fails', () => {
      fetch.mockResponseOnce('{}', { status: 500 });
      return lib.putAsync(url, json, { key }).then((res) => {
        expect(res).toEqual({ type: 'error', details: url, message: 'Internal Server Error' });
      });
    });

    it('captures url in error details on network rejection', () => {
      fetch.mockRejectOnce(new Error('ECONNREFUSED'));
      return lib.putAsync(url, { a: 'b' }, { key }).then((res) => {
        expect(res).toEqual({ type: 'error', details: url, message: 'ECONNREFUSED' });
      });
    });
  });

  describe('queryAsync', () => {
    const key = 'some api key',
      json = {
        index: 'pages',
        body: {
          query: {
            match_all: {}
          }
        }
      },
      jsonString = JSON.stringify(json),
      results = {
        hits: {
          total: 1,
          hits: [{
            _id: 'foo',
            _source: {
              uri: 'foo'
            }
          }]
        }
      },
      resultsString = JSON.stringify(results),
      noResults = {
        hits: {
          total: 0,
          hits: []
        }
      },
      noResultsString = JSON.stringify(noResults);

    it('throws error if no api key specified', () => {
      expect(() => lib.queryAsync(url, json)).toThrow('Please specify API key to do POST requests against Clay!');
    });

    it('returns error if elastic errors', () => {
      fetch.mockResponseOnce('[parsing_exception] [prefix] malformed query, expected [END_OBJECT] but found [FIELD_NAME], with { line=1 & col=50 } :: {"path":"/pages/_doc/_search","query"...', { headers: { 'content-type': 'text/html; charset=utf-8' }});
      return lib.queryAsync(url, json, { key }).then((res) => {
        expect(res).toEqual({ type: 'error', details: url, message: '[parsing_exception] [prefix] malformed query, expected [END_OBJECT] but found [FIELD_NAME], with { line=1 & col=50 }', url });
      });
    });

    it('fetches results', () => {
      fetch.mockResponseOnce(resultsString);
      return lib.queryAsync(url, json, { key }).then((res) => {
        expect(res).toEqual({ type: 'success', details: url, message: '1 result', data: [{ _id: 'foo', uri: 'foo' }], total: 1 });
        expect(fetch).toHaveBeenCalledWith(url, {
          method: 'POST',
          agent: null,
          body: jsonString,
          headers: {
            Authorization: `Token ${key}`,
            'Content-Type': 'application/json; charset=UTF-8'
          }
        });
      });
    });

    it('fetches zero results', () => {
      fetch.mockResponseOnce(noResultsString);
      return lib.queryAsync(url, json, { key }).then((res) => {
        expect(res).toEqual({ type: 'error', details: url, message: 'No results', url });
        expect(fetch).toHaveBeenCalledWith(url, {
          method: 'POST',
          agent: null,
          body: jsonString,
          headers: {
            Authorization: `Token ${key}`,
            'Content-Type': 'application/json; charset=UTF-8'
          }
        });
      });
    });

    it('uses https agent for ssl calls', () => {
      fetch.mockResponseOnce(resultsString);
      return lib.queryAsync(url2, json, { key }).then(() => {
        expect(fetch.mock.calls[0][1].agent).not.toBeNull();
      });
    });

    it('uses headers', () => {
      fetch.mockResponseOnce(resultsString);
      return lib.queryAsync(url, json, { key, headers: { some_header: 'value' }}).then(() => {
        expect(fetch.mock.calls[0][1].headers).toEqual({
          Authorization: `Token ${key}`,
          'Content-Type': 'application/json; charset=UTF-8',
          some_header: 'value'
        });
      });
    });

    it('returns error result if POST fails', () => {
      fetch.mockResponseOnce('{}', { status: 500 });
      return lib.queryAsync(url, json, { key }).then((res) => {
        expect(res).toEqual({ type: 'error', details: url, message: 'Internal Server Error' });
      });
    });

    it('pluralizes result count for multiple hits', () => {
      var multiResults = JSON.stringify({
        hits: {
          total: 5,
          hits: [
            { _id: 'a', _source: { uri: 'a' } },
            { _id: 'b', _source: { uri: 'b' } },
            { _id: 'c', _source: { uri: 'c' } },
            { _id: 'd', _source: { uri: 'd' } },
            { _id: 'e', _source: { uri: 'e' } }
          ]
        }
      });

      fetch.mockResponseOnce(multiResults);
      return lib.queryAsync(url, json, { key }).then((res) => {
        expect(res.type).toBe('success');
        expect(res.message).toBe('5 results');
        expect(res.total).toBe(5);
        expect(res.data).toHaveLength(5);
      });
    });

    it('merges _source with _id for each hit', () => {
      var hitResults = JSON.stringify({
        hits: {
          total: 1,
          hits: [{ _id: 'myId', _source: { uri: 'myUri', title: 'Test' } }]
        }
      });

      fetch.mockResponseOnce(hitResults);
      return lib.queryAsync(url, json, { key }).then((res) => {
        expect(res.data[0]).toEqual({ _id: 'myId', uri: 'myUri', title: 'Test' });
      });
    });

    it('returns error on network rejection', () => {
      fetch.mockRejectOnce(new Error('ECONNREFUSED'));
      return lib.queryAsync(url, json, { key }).then((res) => {
        expect(res).toEqual({ type: 'error', details: url, message: 'ECONNREFUSED' });
      });
    });
  });

  describe('findURIAsync', () => {
    it('finds page uri with one hop', () => {
      fetch.mockResponseOnce('domain.com/_pages/foo');
      return lib.findURIAsync('http://domain.com/some-slug.html').then((res) => {
        expect(res).toEqual({ uri: 'domain.com/_pages/foo', prefix: 'http://domain.com'});
      });
    });

    it('works with ssl', () => {
      fetch.mockResponseOnce('domain.com/_pages/foo');
      return lib.findURIAsync('https://domain.com/some-slug.html').then((res) => {
        expect(res).toEqual({ uri: 'domain.com/_pages/foo', prefix: 'https://domain.com' });
      });
    });

    it('finds page uri with two hops', () => {
      fetch.mockResponseOnce('', { status: 404 });
      fetch.mockResponseOnce('domain.com/_pages/foo');
      return lib.findURIAsync('http://domain.com/path/some-slug.html').then((res) => {
        expect(res).toEqual({ uri: 'domain.com/_pages/foo', prefix: 'http://domain.com' });
      });
    });

    it('finds page uri with three hops (deep path)', () => {
      fetch.mockResponseOnce('', { status: 404 }); // /a/b fails
      fetch.mockResponseOnce('', { status: 404 }); // /a fails
      fetch.mockResponseOnce('domain.com/_pages/foo'); // bare hostname succeeds
      return lib.findURIAsync('http://domain.com/a/b/some-slug.html').then((res) => {
        expect(res).toEqual({ uri: 'domain.com/_pages/foo', prefix: 'http://domain.com' });
      });
    });

    it('encodes public URI as base64 in _uris lookup', () => {
      fetch.mockResponseOnce('domain.com/_pages/foo');
      return lib.findURIAsync('http://domain.com/some-slug.html').then(() => {
        var calledUrl = fetch.mock.calls[0][0];

        // the public URI (hostname + pathname) should be base64-encoded in the _uris path
        expect(calledUrl).toContain('/_uris/');
        expect(calledUrl).toContain('ZG9tYWluLmNvbS9zb21lLXNsdWcuaHRtbA'); // base64 of 'domain.com/some-slug.html'
      });
    });

    it('rejects if no relevant api route', () => {
      fetch.mockResponse('', { status: 404 });
      return lib.findURIAsync('http://domain.com/some-slug.html').catch((e) => {
        expect(e.message).toBe('Unable to find a Clay api for domain.com/some-slug.html');
      });
    });
  });

  describe('isElasticPrefixAsync', () => {
    it('returns true if _components endpoint exists at prefix', () => {
      fetch.mockResponseOnce('{}');
      return lib.isElasticPrefixAsync('http://domain.com').then((res) => {
        expect(res).toBe(true);
      });
    });

    it('returns false if _components endpoint does not exist at prefix', () => {
      fetch.mockResponseOnce('{}', { status: 404 });
      return lib.isElasticPrefixAsync('http://domain.com').then((res) => {
        expect(res).toBe(false);
      });
    });

    it('works for ssl', () => {
      fetch.mockResponseOnce('{}');
      return lib.isElasticPrefixAsync('https://domain.com').then(() => {
        expect(fetch.mock.calls[0][1].agent).not.toBeNull();
      });
    });

    it('returns false on network rejection', () => {
      fetch.mockRejectOnce(new Error('ECONNREFUSED'));
      return lib.isElasticPrefixAsync('http://domain.com').then((res) => {
        expect(res).toBe(false);
      });
    });
  });

  // --- Highland stream adapter tests ---
  // Verify backward-compat wrappers still produce Highland streams

  describe('Highland stream adapter', () => {
    it('get() returns a Highland stream', () => {
      var stream;

      fetch.mockResponseOnce(JSON.stringify({ a: 'b' }));
      stream = lib.get(url);
      expect(typeof stream.toPromise).toBe('function');
      return stream.toPromise(Promise).then((res) => {
        expect(res).toEqual({ a: 'b' });
      });
    });

    it('put() returns a Highland stream', () => {
      var stream;

      fetch.mockResponseOnce('{}');
      stream = lib.put(url, { a: 'b' }, { key: 'abc' });
      expect(typeof stream.toPromise).toBe('function');
      return stream.toPromise(Promise).then((res) => {
        expect(res).toEqual({ type: 'success', message: url });
      });
    });

    it('findURI() returns a Highland stream', () => {
      var stream;

      fetch.mockResponseOnce('domain.com/_pages/foo');
      stream = lib.findURI('http://domain.com/some-slug.html');
      expect(typeof stream.toPromise).toBe('function');
      return stream.toPromise(Promise).then((res) => {
        expect(res).toEqual({ uri: 'domain.com/_pages/foo', prefix: 'http://domain.com' });
      });
    });
  });
});

/* global fetch:false */

'use strict';
const lib = require('./rest'),
  url = 'http://domain.com/foo',
  url2 = 'https://domain.com/bar';

describe('rest', () => {
  afterEach(() => {
    fetch.resetMocks();
  });

  it('catches on rejection', () => {
    fetch.mockRejectOnce(new Error('nope'));
    return lib.get(url).toPromise(Promise).catch((e) => {
      expect(e.message).toBe('nope');
      expect(e.details).toBe(url);
    });
  });

  it('catches on auth redirect', () => {
    fetch.mockResponseOnce('{}', { status: 401 });
    return lib.get(url).toPromise(Promise).catch((e) => {
      expect(e.message).toBe('401 Unauthorized');
      expect(e.details).toBe(url);
    });
  });

  it('catches on client errors', () => {
    fetch.mockResponseOnce('{}', { status: 400 });
    return lib.get(url).toPromise(Promise).catch((e) => {
      expect(e.message).toBe('400 Bad Request');
      expect(e.details).toBe(url);
    });
  });

  it('catches on server errors', () => {
    fetch.mockResponseOnce('{}', { status: 500 });
    return lib.get(url).toPromise(Promise).catch((e) => {
      expect(e.message).toBe('500 Internal Server Error');
      expect(e.details).toBe(url);
    });
  });

  describe('error messages', () => {
    const networkError = (cause) => Object.assign(new Error('fetch failed'), { cause });

    it('has the status code and the reason amphora gave, from a json body', async () => {
      fetch.mockResponseOnce(JSON.stringify({ code: 400, message: 'Cannot publish: page has no layout' }), { status: 400 });

      const res = await lib.get(url).toPromise(Promise);

      expect(res).toBeInstanceOf(Error);
      expect(res.message).toBe('400 Bad Request: Cannot publish: page has no layout');
      expect(res.status).toBe(400);
      expect(res.url).toBe(url);
    });

    it('has the reason from a text body, without repeating the status code', async () => {
      fetch.mockResponseOnce('404 Component foo not found', { status: 404 });

      const res = await lib.get(url).toPromise(Promise);

      expect(res.message).toBe('404 Not Found: Component foo not found');
    });

    it('does not print a whole html page as the reason', async () => {
      fetch.mockResponseOnce('<html><body>Oops</body></html>', { status: 500 });

      const res = await lib.get(url).toPromise(Promise);

      expect(res.message).toBe('500 Internal Server Error');
    });

    it('does not repeat the status text as the reason', async () => {
      fetch.mockResponseOnce(JSON.stringify({ message: 'Not Found' }), { status: 404 });

      const res = await lib.get(url).toPromise(Promise);

      expect(res.message).toBe('404 Not Found');
    });

    it('has the status code when the server sends no status text', async () => {
      // e.g. over http/2, where there is no status text
      fetch.mockImplementationOnce(() => Promise.resolve({ status: 502, statusText: '', text: () => Promise.resolve('') }));

      const res = await lib.get(url).toPromise(Promise);

      expect(res.message).toBe('502');
    });

    it('cuts a very long reason short', async () => {
      fetch.mockResponseOnce(JSON.stringify({ message: 'x'.repeat(1000) }), { status: 500 });

      const res = await lib.get(url).toPromise(Promise);

      expect(res.message.length).toBeLessThan(330);
      expect(res.message).toMatch(/^500 Internal Server Error: x+\.\.\.$/);
    });

    it('has the status code and the reason in a failed PUT result', async () => {
      fetch.mockResponseOnce(JSON.stringify({ message: 'Component foo not found' }), { status: 404 });

      const res = await lib.put(url, { a: 'b' }, { key: 'abc' }).toPromise(Promise);

      expect(res).toEqual({ type: 'error', details: url, message: '404 Not Found: Component foo not found', status: 404 });
    });

    it('has the cause node gives for a failed connection', async () => {
      fetch.mockRejectOnce(networkError(Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:443'), { code: 'ECONNREFUSED' })));

      const res = await lib.put(url, { a: 'b' }, { key: 'abc' }).toPromise(Promise);

      expect(res).toEqual({ type: 'error', details: url, message: 'fetch failed: connect ECONNREFUSED 127.0.0.1:443' });
    });

    it('has the cause code when its message does not', async () => {
      fetch.mockRejectOnce(networkError(Object.assign(new Error('unable to verify the first certificate'), { code: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' })));

      const res = await lib.put(url, { a: 'b' }, { key: 'abc' }).toPromise(Promise);

      expect(res.message).toBe('fetch failed: UNABLE_TO_VERIFY_LEAF_SIGNATURE unable to verify the first certificate');
    });

    it('has the first cause when several addresses were tried', async () => {
      fetch.mockRejectOnce(networkError(Object.assign(new Error(''), { errors: [Object.assign(new Error('connect ECONNREFUSED ::1:443'), { code: 'ECONNREFUSED' })] })));

      const res = await lib.get(url).toPromise(Promise);

      expect(res.message).toBe('fetch failed: connect ECONNREFUSED ::1:443');
    });
  });

  describe('get', () => {
    it('gets json', () => {
      fetch.mockResponseOnce(JSON.stringify({ a: 'b' }));
      return lib.get(url).toPromise(Promise).then((res) => {
        expect(res).toEqual({ a: 'b' });
      });
    });

    it('gets text', () => {
      fetch.mockResponseOnce('hi');
      return lib.get(url, { type: 'text' }).toPromise(Promise).then((res) => {
        expect(res).toBe('hi');
      });
    });

    it('uses https agent for ssl calls', () => {
      fetch.mockResponseOnce(JSON.stringify({ a: 'b' }));
      return lib.get(url2).toPromise(Promise).then(() => {
        expect(fetch.mock.calls[0][1].agent).not.toBeNull();
      });
    });

    it('uses headers', () => {
      fetch.mockResponseOnce(JSON.stringify({ a: 'b' }));
      return lib.get(url, { headers: { Authorization: 'Token abc' }}).toPromise(Promise).then(() => {
        expect(fetch.mock.calls[0][1].headers).toEqual({ Authorization: 'Token abc' });
      });
    });
  });

  describe('put', () => {
    const key = 'some api key',
      json = { a: 'b' },
      jsonString = JSON.stringify(json);

    it('throws error if no api key specified', () => {
      expect(() => lib.put(url, json)).toThrow('Please specify API key to do PUT requests against Clay!');
    });

    it('sends json', () => {
      fetch.mockResponseOnce(json);
      return lib.put(url, json, { key }).toPromise(Promise).then((res) => {
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
      return lib.put(url, null, { key }).toPromise(Promise).then((res) => {
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
      return lib.put(url, 'hi', { type: 'text', key }).toPromise(Promise).then((res) => {
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
      return lib.put(url2, json, { key }).toPromise(Promise).then(() => {
        expect(fetch.mock.calls[0][1].agent).not.toBeNull();
      });
    });

    it('uses headers', () => {
      fetch.mockResponseOnce(json);
      return lib.put(url, json, { key, headers: { some_header: 'value' }}).toPromise(Promise).then(() => {
        expect(fetch.mock.calls[0][1].headers).toEqual({
          Authorization: `Token ${key}`,
          'Content-Type': 'application/json; charset=UTF-8',
          some_header: 'value'
        });
      });
    });

    it('returns stream of errors if PUT fails', () => {
      fetch.mockResponseOnce('{}', { status: 500 });
      return lib.put(url, json, { key }).toPromise(Promise).then((res) => {
        expect(res).toEqual({ type: 'error', details: url, message: '500 Internal Server Error', status: 500 });
      });
    });
  });

  describe('query', () => {
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
      expect(() => lib.query(url, json)).toThrow('Please specify API key to do POST requests against Clay!');
    });

    it('returns error if elastic errors', () => {
      fetch.mockResponseOnce('[parsing_exception] [prefix] malformed query, expected [END_OBJECT] but found [FIELD_NAME], with { line=1 & col=50 } :: {"path":"/pages/_doc/_search","query"...', { headers: { 'content-type': 'text/html; charset=utf-8' }});
      return lib.query(url, json, { key }).toPromise(Promise).then((res) => {
        expect(res).toEqual({ type: 'error', details: url, message: '[parsing_exception] [prefix] malformed query, expected [END_OBJECT] but found [FIELD_NAME], with { line=1 & col=50 }', url });
      });
    });

    it('fetches results', () => {
      fetch.mockResponseOnce(resultsString);
      return lib.query(url, json, { key }).toPromise(Promise).then((res) => {
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
      return lib.query(url, json, { key }).toPromise(Promise).then((res) => {
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
      return lib.query(url2, json, { key }).toPromise(Promise).then(() => {
        expect(fetch.mock.calls[0][1].agent).not.toBeNull();
      });
    });

    it('uses headers', () => {
      fetch.mockResponseOnce(resultsString);
      return lib.query(url, json, { key, headers: { some_header: 'value' }}).toPromise(Promise).then(() => {
        expect(fetch.mock.calls[0][1].headers).toEqual({
          Authorization: `Token ${key}`,
          'Content-Type': 'application/json; charset=UTF-8',
          some_header: 'value'
        });
      });
    });

    it('returns stream of errors if POST fails', () => {
      fetch.mockResponseOnce('{}', { status: 500 });
      return lib.query(url, json, { key }).toPromise(Promise).then((res) => {
        expect(res).toEqual({ type: 'error', details: url, message: '500 Internal Server Error', status: 500 });
      });
    });
  });

  describe('findURI', () => {
    it('finds page uri with one hop', () => {
      fetch.mockResponseOnce('domain.com/_pages/foo');
      return lib.findURI('http://domain.com/some-slug.html').toPromise(Promise).then((res) => {
        expect(res).toEqual({ uri: 'domain.com/_pages/foo', prefix: 'http://domain.com'});
      });
    });

    it('works with ssl', () => {
      fetch.mockResponseOnce('domain.com/_pages/foo');
      return lib.findURI('https://domain.com/some-slug.html').toPromise(Promise).then((res) => {
        expect(res).toEqual({ uri: 'domain.com/_pages/foo', prefix: 'https://domain.com' });
      });
    });

    it('finds page uri with two hops', () => {
      fetch.mockResponseOnce('', { status: 404 });
      fetch.mockResponseOnce('domain.com/_pages/foo');
      return lib.findURI('http://domain.com/path/some-slug.html').toPromise(Promise).then((res) => {
        expect(res).toEqual({ uri: 'domain.com/_pages/foo', prefix: 'http://domain.com' });
      });
    });

    it('fails if no relevant api route', () => {
      fetch.mockResponse('', { status: 404 });
      return lib.findURI('http://domain.com/some-slug.html').toPromise(Promise).catch((e) => {
        expect(e.message).toBe('Unable to find a Clay api for domain.com/some-slug.html');
      });
    });
  });

  describe('isElasticPrefix', () => {
    it('returns true if _search endpoint exists at prefix', () => {
      fetch.mockResponseOnce('{}');
      return lib.isElasticPrefix('http://domain.com').toPromise(Promise).then((res) => {
        expect(res).toBe(true);
      });
    });

    it('returns false if _search endpoint does not exist at prefix', () => {
      fetch.mockResponseOnce('{}', { status: 404 });
      return lib.isElasticPrefix('http://domain.com').toPromise(Promise).then((res) => {
        expect(res).toBe(false);
      });
    });

    it('works for ssl', () => {
      fetch.mockResponseOnce('{}');
      return lib.isElasticPrefix('https://domain.com').toPromise(Promise).then(() => {
        expect(fetch.mock.calls[0][1].agent).not.toBeNull();
      });
    });
  });
});

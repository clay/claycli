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
      expect(e.message).toBe('Unauthorized');
      expect(e.details).toBe(url);
    });
  });

  it('catches on client errors', () => {
    fetch.mockResponseOnce('{}', { status: 400 });
    return lib.get(url).toPromise(Promise).catch((e) => {
      expect(e.message).toBe('Bad Request');
      expect(e.details).toBe(url);
    });
  });

  it('catches on server errors', () => {
    fetch.mockResponseOnce('{}', { status: 500 });
    return lib.get(url).toPromise(Promise).catch((e) => {
      expect(e.message).toBe('Internal Server Error');
      expect(e.details).toBe(url);
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
        expect(res).toEqual({ type: 'error', details: url, message: 'Internal Server Error' });
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
        expect(res).toEqual({ type: 'error', details: url, message: 'Internal Server Error' });
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

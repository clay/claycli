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
    return lib.get(h([url])).toPromise().catch((e) => {
      expect(e.message).toBe('nope');
    });
  });

  it('catches on auth redirect', () => {
    fetch.mockResponseOnce('{}', { status: 401 });
    return lib.get(h([url])).toPromise().catch((e) => {
      expect(e.message).toBe('Unauthorized');
    });
  });

  it('catches on client errors', () => {
    fetch.mockResponseOnce('{}', { status: 400 });
    return lib.get(h([url])).toPromise().catch((e) => {
      expect(e.message).toBe('Bad Request');
    });
  });

  it('catches on server errors', () => {
    fetch.mockResponseOnce('{}', { status: 500 });
    return lib.get(h([url])).toPromise().catch((e) => {
      expect(e.message).toBe('Internal Server Error');
    });
  });

  describe('get', () => {
    it('gets json', () => {
      fetch.mockResponseOnce(JSON.stringify({ a: 'b' }));
      return lib.get(h([url])).toPromise().then((res) => {
        expect(res).toEqual({ a: 'b' });
      });
    });

    it('gets text', () => {
      fetch.mockResponseOnce('hi');
      return lib.get(h([url]), { type: 'text' }).toPromise().then((res) => {
        expect(res).toBe('hi');
      });
    });

    it('accepts stream of urls', () => {
      fetch.mockResponseOnce(JSON.stringify({ a: 'b' })).mockResponseOnce(JSON.stringify({ c: 'd' }));
      return lib.get(h([url, url2])).collect().toPromise().then((res) => {
        expect(res).toEqual([{ a: 'b' }, { c: 'd' }]);
      });
    });

    it('uses https agent for ssl calls', () => {
      fetch.mockResponseOnce(JSON.stringify({ a: 'b' }));
      return lib.get(h([url2])).toPromise().then(() => {
        expect(fetch.mock.calls[0][1].agent).not.toBeNull();
      });
    });

    it('uses headers', () => {
      fetch.mockResponseOnce(JSON.stringify({ a: 'b' }));
      return lib.get(h([url]), { headers: { Authorization: 'Token abc' }}).toPromise().then(() => {
        expect(fetch.mock.calls[0][1].headers).toEqual({ Authorization: 'Token abc' });
      });
    });
  });

  describe('put', () => {
    const key = 'some api key',
      json = JSON.stringify({ a: 'b' });

    it('throws error if no api key specified', () => {
      expect(() => lib.put(h([url]))).toThrow('Please specify API key to do PUT requests against Clay!');
    });

    it('sends json', () => {
      fetch.mockResponseOnce(json);
      return lib.put(h([{ url, data: json}]), { key }).toPromise().then((res) => {
        expect(res).toEqual({ result: 'success', url });
        expect(fetch).toHaveBeenCalledWith(url, {
          method: 'PUT',
          agent: null,
          body: json,
          headers: {
            Authorization: `Token ${key}`,
            'Content-Type': 'application/json; charset=UTF-8'
          }
        });
      });
    });

    it('sends text', () => {
      fetch.mockResponseOnce('hi');
      return lib.put(h([{ url, data: 'hi' }]), { type: 'text', key }).toPromise().then((res) => {
        expect(res).toEqual({ result: 'success', url });
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

    it('accepts stream of urls', () => {
      fetch.mockResponseOnce(json).mockResponseOnce(JSON.stringify({ c: 'd' }));
      return lib.put(h([{ url, data: json }, { url: url2, data: JSON.stringify({ c: 'd' }) }]), { key }).collect().toPromise().then((res) => {
        expect(res.length).toBe(2);
      });
    });

    it('uses https agent for ssl calls', () => {
      fetch.mockResponseOnce(json);
      return lib.put(h([{ url: url2, data: json }]), { key }).toPromise().then(() => {
        expect(fetch.mock.calls[0][1].agent).not.toBeNull();
      });
    });

    it('uses headers', () => {
      fetch.mockResponseOnce(json);
      return lib.put(h([{ url, data: json }]), { key, headers: { some_header: 'value' }}).toPromise().then(() => {
        expect(fetch.mock.calls[0][1].headers).toEqual({
          Authorization: `Token ${key}`,
          'Content-Type': 'application/json; charset=UTF-8',
          some_header: 'value'
        });
      });
    });

    it('returns stream of errors if PUT fails', () => {
      fetch.mockResponseOnce('{}', { status: 500 });
      return lib.put(h([{ url, data: json}]), { key }).toPromise().then((res) => {
        expect(res).toEqual({ result: 'error', url, message: 'Internal Server Error' });
      });
    });
  });
});

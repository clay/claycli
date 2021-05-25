/* global fetch:false */

'use strict';
const lib = require('./export'),
  concurrency = 1000;

describe('export', () => {
  afterEach(() => {
    fetch.resetMocks();
  });

  describe('fromURL', () => {
    it('errors if no url defined', () => {
      return lib.fromURL(null, { yaml: true, concurrency }).collect().toPromise(Promise).catch((e) => {
        expect(e.message).toBe('URL is not defined! Please specify a url to export from');
      });
    });

    it('exports bootstrap stream', () => {
      fetch.mockResponseOnce(JSON.stringify({ a: 'b' }));
      return lib.fromURL('http://domain.com/_components/foo', { yaml: true, concurrency }).collect().toPromise(Promise).then((res) => {
        expect(res).toEqual([{
          _components: {
            foo: {
              a: 'b'
            }
          }
        }]);
      });
    });

    it('exports dispatch from component instance', () => {
      fetch.mockResponseOnce(JSON.stringify({ a: 'b' }));
      return lib.fromURL('http://domain.com/_components/foo', { concurrency }).collect().toPromise(Promise).then((res) => {
        expect(res).toEqual([{ '/_components/foo': { a: 'b' }}]);
      });
    });

    it('exports dispatch from deep component instance', () => {
      fetch.mockResponseOnce(JSON.stringify({
        a: 'b',
        content: [{
          _ref: 'domain.com/_components/bar',
          c: 'd'
        }]
      }));
      return lib.fromURL('http://domain.com/_components/foo', { concurrency }).collect().toPromise(Promise).then((res) => {
        expect(res).toEqual([{ '/_components/foo': { a: 'b', content: [{ _ref: '/_components/bar', c: 'd' }] }}]);
      });
    });

    it('exports dispatch from all component instances', () => {
      fetch.mockResponseOnce(JSON.stringify(['domain.com/_components/foo/instances/1', 'domain.com/_components/foo/instances/2']));
      fetch.mockResponseOnce(JSON.stringify({ a: 'b' }));
      fetch.mockResponseOnce(JSON.stringify({ c: 'd' }));
      return lib.fromURL('http://domain.com/_components/foo/instances', { concurrency }).collect().toPromise(Promise).then((res) => {
        expect(res).toEqual([{ '/_components/foo/instances/1': { a: 'b' } }, { '/_components/foo/instances/2': { c: 'd' } }]);
      });
    });

    it('exports dispatch from all components', () => {
      fetch.mockResponseOnce(JSON.stringify(['foo', 'bar']));
      fetch.mockResponseOnce(JSON.stringify(['domain.com/_components/foo/instances/1', 'domain.com/_components/foo/instances/2']));
      fetch.mockResponseOnce(JSON.stringify(['domain.com/_components/bar/instances/1']));
      fetch.mockResponseOnce(JSON.stringify({ a: 'b' })); // foo 1
      fetch.mockResponseOnce(JSON.stringify({ c: 'd' })); // foo 2
      fetch.mockResponseOnce(JSON.stringify({ e: 'f' })); // bar 1
      return lib.fromURL('http://domain.com/_components', { concurrency }).collect().toPromise(Promise).then((res) => {
        expect(res).toEqual([{ '/_components/foo/instances/1': { a: 'b' } }, { '/_components/foo/instances/2': { c: 'd' } }, { '/_components/bar/instances/1': { e: 'f' } }]);
      });
    });

    it('exports dispatch from layout instance', () => {
      fetch.mockResponseOnce(JSON.stringify({ a: 'b' }));
      return lib.fromURL('http://domain.com/_layouts/foo', { concurrency }).collect().toPromise(Promise).then((res) => {
        expect(res).toEqual([{ '/_layouts/foo': { a: 'b' }}]);
      });
    });

    it('exports dispatch from deep layout instance', () => {
      fetch.mockResponseOnce(JSON.stringify({
        a: 'b',
        content: [{
          _ref: 'domain.com/_components/bar',
          c: 'd'
        }]
      }));
      return lib.fromURL('http://domain.com/_layouts/foo', { concurrency }).collect().toPromise(Promise).then((res) => {
        expect(res).toEqual([{ '/_layouts/foo': { a: 'b', content: [{ _ref: '/_components/bar', c: 'd' }] }}]);
      });
    });

    it('exports dispatch from all layout instances', () => {
      fetch.mockResponseOnce(JSON.stringify(['domain.com/_layouts/foo/instances/1', 'domain.com/_layouts/foo/instances/2']));
      fetch.mockResponseOnce(JSON.stringify({ a: 'b' }));
      fetch.mockResponseOnce(JSON.stringify({ c: 'd' }));
      return lib.fromURL('http://domain.com/_layouts/foo/instances', { concurrency }).collect().toPromise(Promise).then((res) => {
        expect(res).toEqual([{ '/_layouts/foo/instances/1': { a: 'b' } }, { '/_layouts/foo/instances/2': { c: 'd' } }]);
      });
    });

    it('exports dispatch from all layouts', () => {
      fetch.mockResponseOnce(JSON.stringify(['foo', 'bar']));
      fetch.mockResponseOnce(JSON.stringify(['domain.com/_layouts/foo/instances/1', 'domain.com/_layouts/foo/instances/2']));
      fetch.mockResponseOnce(JSON.stringify(['domain.com/_layouts/bar/instances/1']));
      fetch.mockResponseOnce(JSON.stringify({ a: 'b' })); // foo 1
      fetch.mockResponseOnce(JSON.stringify({ c: 'd' })); // foo 2
      fetch.mockResponseOnce(JSON.stringify({ e: 'f' })); // bar 1
      return lib.fromURL('http://domain.com/_layouts', { concurrency }).collect().toPromise(Promise).then((res) => {
        expect(res).toEqual([{ '/_layouts/foo/instances/1': { a: 'b' } }, { '/_layouts/foo/instances/2': { c: 'd' } }, { '/_layouts/bar/instances/1': { e: 'f' } }]);
      });
    });

    it('exports dispatch from page (legacy)', () => {
      fetch.mockResponseOnce(JSON.stringify({
        layout: 'domain.com/_components/layout/instances/1',
        main: ['domain.com/_components/foo/instances/1']
      }));
      fetch.mockResponseOnce(JSON.stringify({ a: 'b' }));
      return lib.fromURL('http://domain.com/_pages/foo', { concurrency }).collect().toPromise(Promise).then((res) => {
        expect(res).toEqual([
          { '/_components/foo/instances/1': { a: 'b' }},
          { '/_pages/foo': { layout: '/_components/layout/instances/1', main: ['/_components/foo/instances/1'] }}
        ]);
      });
    });

    it('exports dispatch from page with layout (legacy)', () => {
      fetch.mockResponseOnce(JSON.stringify({
        layout: 'domain.com/_components/layout/instances/1',
        main: ['domain.com/_components/foo/instances/1']
      }));
      fetch.mockResponseOnce(JSON.stringify({ a: 'b' }));
      fetch.mockResponseOnce(JSON.stringify({ main: 'main' }));
      return lib.fromURL('http://domain.com/_pages/foo', { layout: true, concurrency }).collect().toPromise(Promise).then((res) => {
        expect(res).toEqual([
          { '/_components/foo/instances/1': { a: 'b' }},
          { '/_components/layout/instances/1': { main: 'main' }},
          { '/_pages/foo': { layout: '/_components/layout/instances/1', main: ['/_components/foo/instances/1'] } }
        ]);
        lib.clearLayouts();
      });
    });

    it('exports dispatch from all pages (legacy)', () => {
      fetch.mockResponseOnce(JSON.stringify(['domain.com/_pages/foo', 'domain.com/_pages/bar']));
      fetch.mockResponseOnce(JSON.stringify({
        layout: 'domain.com/_components/layout/instances/1',
        main: ['domain.com/_components/foo/instances/1']
      }));
      fetch.mockResponseOnce(JSON.stringify({
        layout: 'domain.com/_components/layout/instances/1',
        main: ['domain.com/_components/foo/instances/2']
      }));
      fetch.mockResponseOnce(JSON.stringify({ a: 'b' }));
      fetch.mockResponseOnce(JSON.stringify({ c: 'd' }));
      return lib.fromURL('http://domain.com/_pages', { concurrency }).collect().toPromise(Promise).then((res) => {
        expect(res).toEqual([
          { '/_components/foo/instances/1': { a: 'b' }},
          { '/_pages/foo': { layout: '/_components/layout/instances/1', main: ['/_components/foo/instances/1'] } },
          { '/_components/foo/instances/2': { c: 'd' }},
          { '/_pages/bar': { layout: '/_components/layout/instances/1', main: ['/_components/foo/instances/2'] } }
        ]);
      });
    });

    it('exports dispatch from all pages with shared layout (legacy)', () => {
      fetch.mockResponseOnce(JSON.stringify(['domain.com/_pages/foo', 'domain.com/_pages/bar']));
      fetch.mockResponseOnce(JSON.stringify({
        layout: 'domain.com/_components/layout/instances/1',
        main: ['domain.com/_components/foo/instances/1']
      }));
      fetch.mockResponseOnce(JSON.stringify({
        layout: 'domain.com/_components/layout/instances/1',
        main: ['domain.com/_components/foo/instances/2']
      }));
      fetch.mockResponseOnce(JSON.stringify({ a: 'b' }));
      fetch.mockResponseOnce(JSON.stringify({ main: 'main' }));
      fetch.mockResponseOnce(JSON.stringify({ c: 'd' }));
      return lib.fromURL('http://domain.com/_pages', { layout: true, concurrency }).collect().toPromise(Promise).then((res) => {
        expect(res).toEqual([
          { '/_components/foo/instances/1': { a: 'b' }},
          { '/_components/layout/instances/1': { main: 'main' }}, // only appears once
          { '/_pages/foo': { layout: '/_components/layout/instances/1', main: ['/_components/foo/instances/1'] } },
          { '/_components/foo/instances/2': { c: 'd' }},
          { '/_pages/bar': { layout: '/_components/layout/instances/1', main: ['/_components/foo/instances/2'] } }
        ]);
        lib.clearLayouts();
      });
    });

    it('exports dispatch from page', () => {
      fetch.mockResponseOnce(JSON.stringify({
        layout: 'domain.com/_layouts/layout/instances/1',
        main: ['domain.com/_components/foo/instances/1']
      }));
      fetch.mockResponseOnce(JSON.stringify({ a: 'b' }));
      return lib.fromURL('http://domain.com/_pages/foo', { concurrency }).collect().toPromise(Promise).then((res) => {
        expect(res).toEqual([
          { '/_components/foo/instances/1': { a: 'b' }},
          { '/_pages/foo': { layout: '/_layouts/layout/instances/1', main: ['/_components/foo/instances/1'] }}
        ]);
      });
    });

    it('exports dispatch from page with layout', () => {
      fetch.mockResponseOnce(JSON.stringify({
        layout: 'domain.com/_layouts/layout/instances/1',
        main: ['domain.com/_components/foo/instances/1']
      }));
      fetch.mockResponseOnce(JSON.stringify({ a: 'b' }));
      fetch.mockResponseOnce(JSON.stringify({ main: 'main' }));
      return lib.fromURL('http://domain.com/_pages/foo', { layout: true, concurrency }).collect().toPromise(Promise).then((res) => {
        expect(res).toEqual([
          { '/_components/foo/instances/1': { a: 'b' }},
          { '/_layouts/layout/instances/1': { main: 'main' }},
          { '/_pages/foo': { layout: '/_layouts/layout/instances/1', main: ['/_components/foo/instances/1'] } }
        ]);
        lib.clearLayouts();
      });
    });

    it('exports dispatch from all pages', () => {
      fetch.mockResponseOnce(JSON.stringify(['domain.com/_pages/foo', 'domain.com/_pages/bar']));
      fetch.mockResponseOnce(JSON.stringify({
        layout: 'domain.com/_layouts/layout/instances/1',
        main: ['domain.com/_components/foo/instances/1']
      }));
      fetch.mockResponseOnce(JSON.stringify({
        layout: 'domain.com/_layouts/layout/instances/1',
        main: ['domain.com/_components/foo/instances/2']
      }));
      fetch.mockResponseOnce(JSON.stringify({ a: 'b' }));
      fetch.mockResponseOnce(JSON.stringify({ c: 'd' }));
      return lib.fromURL('http://domain.com/_pages', { concurrency }).collect().toPromise(Promise).then((res) => {
        expect(res).toEqual([
          { '/_components/foo/instances/1': { a: 'b' }},
          { '/_pages/foo': { layout: '/_layouts/layout/instances/1', main: ['/_components/foo/instances/1'] } },
          { '/_components/foo/instances/2': { c: 'd' }},
          { '/_pages/bar': { layout: '/_layouts/layout/instances/1', main: ['/_components/foo/instances/2'] } }
        ]);
      });
    });

    it('exports dispatch from all pages with shared layout', () => {
      fetch.mockResponseOnce(JSON.stringify(['domain.com/_pages/foo', 'domain.com/_pages/bar']));
      fetch.mockResponseOnce(JSON.stringify({
        layout: 'domain.com/_layouts/layout/instances/1',
        main: ['domain.com/_components/foo/instances/1']
      }));
      fetch.mockResponseOnce(JSON.stringify({
        layout: 'domain.com/_layouts/layout/instances/1',
        main: ['domain.com/_components/foo/instances/2']
      }));
      fetch.mockResponseOnce(JSON.stringify({ a: 'b' }));
      fetch.mockResponseOnce(JSON.stringify({ main: 'main' }));
      fetch.mockResponseOnce(JSON.stringify({ c: 'd' }));
      return lib.fromURL('http://domain.com/_pages', { layout: true, concurrency }).collect().toPromise(Promise).then((res) => {
        expect(res).toEqual([
          { '/_components/foo/instances/1': { a: 'b' }},
          { '/_layouts/layout/instances/1': { main: 'main' }}, // only appears once
          { '/_pages/foo': { layout: '/_layouts/layout/instances/1', main: ['/_components/foo/instances/1'] } },
          { '/_components/foo/instances/2': { c: 'd' }},
          { '/_pages/bar': { layout: '/_layouts/layout/instances/1', main: ['/_components/foo/instances/2'] } },
        ]);
        lib.clearLayouts();
      });
    });

    it('exports dispatch from uri', () => {
      fetch.mockResponseOnce('domain.com/_pages/foo');
      return lib.fromURL('http://domain.com/_uris/ZG9tYWluLmNvbS9mb28=', { concurrency }).collect().toPromise(Promise).then((res) => {
        expect(res).toEqual([{ '/_uris/foo': '/_pages/foo' }]);
      });
    });

    it('exports dispatch from all uris', () => {
      fetch.mockResponseOnce(JSON.stringify(['domain.com/_uris/ZG9tYWluLmNvbS9mb28=', 'domain.com/_uris/ZG9tYWluLmNvbS9iYXI=']));
      fetch.mockResponseOnce('domain.com/_pages/foo');
      fetch.mockResponseOnce('domain.com/_pages/bar');
      return lib.fromURL('http://domain.com/_uris', { concurrency }).collect().toPromise(Promise).then((res) => {
        expect(res).toEqual([{ '/_uris/foo': '/_pages/foo' }, { '/_uris/bar': '/_pages/bar' }]);
      });
    });

    it('exports dispatch from list', () => {
      fetch.mockResponseOnce(JSON.stringify(['a', 'b', 'c']));
      return lib.fromURL('http://domain.com/_lists/foo', { concurrency }).collect().toPromise(Promise).then((res) => {
        expect(res).toEqual([{ '/_lists/foo': ['a', 'b', 'c'] }]);
      });
    });

    it('exports dispatch from all lists', () => {
      fetch.mockResponseOnce(JSON.stringify(['domain.com/_lists/foo', 'domain.com/_lists/bar']));
      fetch.mockResponseOnce(JSON.stringify(['a', 'b', 'c']));
      fetch.mockResponseOnce(JSON.stringify(['d', 'e', 'f']));
      return lib.fromURL('http://domain.com/_lists', { concurrency }).collect().toPromise(Promise).then((res) => {
        expect(res).toEqual([{ '/_lists/foo': ['a', 'b', 'c'] }, { '/_lists/bar': ['d', 'e', 'f'] }]);
      });
    });

    it('exports dispatch from user', () => {
      fetch.mockResponseOnce(JSON.stringify({ username: 'alice', provider: 'google', auth: 'admin' }));
      return lib.fromURL('http://domain.com/_users/YWxpY2VAZ29vZ2xl', { concurrency }).collect().toPromise(Promise).then((res) => {
        expect(res).toEqual([{ '/_users/YWxpY2VAZ29vZ2xl': { username: 'alice', provider: 'google', auth: 'admin' }}]);
      });
    });

    it('exports dispatch from all users', () => {
      fetch.mockResponseOnce(JSON.stringify(['domain.com/_users/YWxpY2VAZ29vZ2xl', 'domain.com/_users/Ym9iQGdvb2dsZQ==']));
      fetch.mockResponseOnce(JSON.stringify({ username: 'alice', provider: 'google', auth: 'admin' }));
      fetch.mockResponseOnce(JSON.stringify({ username: 'bob', provider: 'google', auth: 'edit' }));
      return lib.fromURL('http://domain.com/_users', { concurrency }).collect().toPromise(Promise).then((res) => {
        expect(res).toEqual([{ '/_users/YWxpY2VAZ29vZ2xl': { username: 'alice', provider: 'google', auth: 'admin' } }, { '/_users/Ym9iQGdvb2dsZQ==': { username: 'bob', provider: 'google', auth: 'edit' } }]);
      });
    });

    it('exports dispatch from public url', () => {
      fetch.mockResponseOnce('domain.com/_pages/foo');
      fetch.mockResponseOnce(JSON.stringify({
        layout: 'domain.com/_components/layout/instances/1',
        main: ['domain.com/_components/foo/instances/1']
      }));
      fetch.mockResponseOnce(JSON.stringify({ a: 'b' }));
      return lib.fromURL('http://domain.com/some-slug', { concurrency }).collect().toPromise(Promise).then((res) => {
        expect(res).toEqual([
          { '/_components/foo/instances/1': { a: 'b' }},
          { '/_pages/foo': { layout: '/_components/layout/instances/1', main: ['/_components/foo/instances/1'] } }
        ]);
      });
    });

    it('returns error if not a supported type of data', () => {
      fetch.mockResponseOnce('', { status: 404 });
      fetch.mockResponseOnce('', { status: 404 });
      return lib.fromURL('http://domain.com/_schedule/foo', { concurrency }).collect().toPromise(Promise).catch((e) => {
        expect(e.message).toBe('Unable to find a Clay api for domain.com/_schedule/foo');
      });
    });

    it('uses default concurrency', () => {
      fetch.mockResponseOnce(JSON.stringify({ a: 'b' }));
      return lib.fromURL('http://domain.com/_components/foo').collect().toPromise(Promise).then((res) => {
        expect(res).toEqual([{ '/_components/foo': { a: 'b' }}]);
      });
    });
  });

  describe('fromQuery', () => {
    const prefix = 'http://domain.com',
      key = 'abc';

    it('throws error if no api key specified', () => {
      expect(() => lib.fromQuery(prefix)).toThrow('Please specify API key to do POST requests against Clay!');
    });

    it('streams error if no url defined', () => {
      return lib.fromQuery(null, {}, { yaml: true, concurrency }).collect().toPromise(Promise).catch((e) => {
        expect(e.message).toBe('URL is not defined! Please specify a site prefix to export from');
      });
    });

    it('streams error if no results found', () => {
      fetch.mockResponseOnce('', { status: 404 });
      return lib.fromQuery('http://domain.com', {}, { yaml: true, concurrency, key }).collect().toPromise(Promise).catch((e) => {
        expect(e).toEqual({ type: 'error', message: 'Not Found', details: 'http://domain.com/_search' });
      });
    });

    it('exports bootstrap stream', () => {
      fetch.mockResponseOnce(JSON.stringify({
        hits: {
          total: 1,
          hits: [{
            _id: 'domain.com/_components/foo',
            _source: { a: 'b' }
          }]
        }
      }));
      fetch.mockResponseOnce(JSON.stringify({ a: 'b', c: 'd' }));
      return lib.fromQuery('http://domain.com', {}, { yaml: true, concurrency, key }).collect().toPromise(Promise).then((res) => {
        expect(res).toEqual([{
          _components: {
            foo: {
              a: 'b',
              c: 'd'
            }
          }
        }]);
      });
    });

    it('exports dispatch from components', () => {
      fetch.mockResponseOnce(JSON.stringify({
        hits: {
          total: 1,
          hits: [{
            _id: 'domain.com/_components/foo',
            _source: { a: 'b' }
          }]
        }
      }));
      fetch.mockResponseOnce(JSON.stringify({ a: 'b', c: 'd' }));
      return lib.fromQuery('http://domain.com', {}, { concurrency, key }).collect().toPromise(Promise).then((res) => {
        expect(res).toEqual([{ '/_components/foo': { a: 'b', c: 'd' }}]);
      });
    });

    it('exports dispatch with size', () => {
      fetch.mockResponseOnce(JSON.stringify({
        hits: {
          total: 1,
          hits: [{
            _id: 'domain.com/_components/foo',
            _source: { a: 'b' }
          }]
        }
      }));
      fetch.mockResponseOnce(JSON.stringify({ a: 'b', c: 'd' }));
      return lib.fromQuery('http://domain.com', {}, { concurrency, key, size: 1 }).collect().toPromise(Promise).then((res) => {
        expect(res).toEqual([{ '/_components/foo': { a: 'b', c: 'd' }}]);
      });
    });

    it('exports dispatch with query', () => {
      fetch.mockResponseOnce(JSON.stringify({
        hits: {
          total: 1,
          hits: [{
            _id: 'domain.com/_components/foo',
            _source: { a: 'b' }
          }]
        }
      }));
      fetch.mockResponseOnce(JSON.stringify({ a: 'b', c: 'd' }));
      return lib.fromQuery('http://domain.com', {
        index: 'some-index',
        body: {
          query: {
            bool: {
              must_not: [{
                exists: { field: 'someField' }
              }]
            }
          }
        }
      }, { concurrency, key }).collect().toPromise(Promise).then((res) => {
        expect(res).toEqual([{ '/_components/foo': { a: 'b', c: 'd' }}]);
      });
    });

    it('uses default concurrency', () => {
      fetch.mockResponseOnce(JSON.stringify({
        hits: {
          total: 1,
          hits: [{
            _id: 'domain.com/_components/foo',
            _source: { a: 'b' }
          }]
        }
      }));
      fetch.mockResponseOnce(JSON.stringify({ a: 'b', c: 'd' }));
      return lib.fromQuery('http://domain.com', null, { key }).collect().toPromise(Promise).then((res) => {
        expect(res).toEqual([{ '/_components/foo': { a: 'b', c: 'd' }}]);
      });
    });
  });
});

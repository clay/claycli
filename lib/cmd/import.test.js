/* global fetch:false */

'use strict';
const yaml = require('js-yaml'),
  h = require('highland'),
  lib = require('./import'),
  url = 'domain.com',
  key = 'abc',
  concurrency = 1000;

describe('import', () => {
  afterEach(() => {
    fetch.resetMocks();
  });

  it('returns error if no url', () => {
    return lib('abc').toPromise(Promise).then((res) => {
      expect(res).toEqual({ type: 'error', message: 'URL is not defined! Please specify a site prefix to import to' });
    });
  });

  it('returns error if not JSON', () => {
    return lib('abc', url).toPromise(Promise).then((res) => {
      expect(res).toEqual({ type: 'error', message: 'Cannot import dispatch from yaml', details: 'Please use the --yaml argument to import from bootstraps' });
    });
  });

  it('returns error if bad JSON', () => {
    return lib(']{"a"\:}', url).toPromise(Promise).then((res) => {
      expect(res).toMatchObject({
        type: 'error',
        details: ']{"a":}',
        message: expect.stringMatching(/^JSON syntax error:/),
      });
    });
  });

  it('returns error if bad YAML', () => {
    return lib(yaml.dump({ a: 'hi' }) + 'a', url, { yaml: true }).toPromise(Promise).then((res) => {
      expect(res).toMatchObject({
        message: expect.stringMatching(/^YAML syntax error/),
        type: 'error',
      });
    });
  });

  it('imports bootstrap from stream', () => {
    fetch.mockResponseOnce('{}');
    return lib(h.of(yaml.dump({ _components: { a: { b: 'c' }} })), url, { yaml: true, key, concurrency }).collect().toPromise(Promise).then((res) => {
      expect(res).toEqual([{ type: 'success', message: 'http://domain.com/_components/a' }]);
    });
  });

  it('adds warning when importing @published item', () => {
    fetch.mockResponseOnce('{}');
    fetch.mockResponseOnce('{}');
    return lib(h.of(yaml.dump({ _components: { a: { instances: { 'b@published': { c: 'd' }} }} })), url, { yaml: true, publish: true, key, concurrency }).collect().toPromise(Promise).then((res) => {
      expect(res).toEqual([{ type: 'success', message: 'http://domain.com/_components/a/instances/b' }, { type: 'success', message: 'http://domain.com/_components/a/instances/b@published' }, { type: 'warning', message: 'Generated latest data for @published item', details: 'http://domain.com/_components/a/instances/b@published' }]);
    });
  });

  it('imports dispatch from stream of strings', () => {
    fetch.mockResponseOnce('{}');
    return lib(h.of(JSON.stringify({ '/_components/a': { b: 'c' } })), url, { key, concurrency }).collect().toPromise(Promise).then((res) => {
      expect(res).toEqual([{ type: 'success', message: 'http://domain.com/_components/a' }]);
    });
  });

  it('imports dispatch from buffer', () => {
    fetch.mockResponseOnce('{}');
    return lib(Buffer.from(JSON.stringify({ '/_components/a': { b: 'c' } })), url, { key, concurrency }).collect().toPromise(Promise).then((res) => {
      expect(res).toEqual([{ type: 'success', message: 'http://domain.com/_components/a' }]);
    });
  });

  it('imports dispatch from string', () => {
    fetch.mockResponseOnce('{}');
    return lib(JSON.stringify({ '/_components/a': { b: 'c' } }), url, { key, concurrency }).collect().toPromise(Promise).then((res) => {
      expect(res).toEqual([{ type: 'success', message: 'http://domain.com/_components/a' }]);
    });
  });

  it('imports dispatch from object', () => {
    fetch.mockResponseOnce('{}');
    return lib({ '/_components/obj': { b: 'c' } }, url, { key, concurrency }).collect().toPromise(Promise).then((res) => {
      expect(res).toEqual([{ type: 'success', message: 'http://domain.com/_components/obj' }]);
    });
  });

  it('allows multiple files with `tail -n +1 filenames` splitter', () => {
    fetch.mockResponseOnce('{}');
    fetch.mockResponseOnce('{}');
    return lib('\n==> ../path/to/doc2.yml <==\n' + yaml.dump({ _components: { a: { b: 'c' }} }) + '\n==> ../path/to/doc2.yml <==\n' + yaml.dump({ _components: { b: { c: 'd' }} }), url, { yaml: true, key, concurrency }).collect().toPromise(Promise).then((res) => {
      expect(res).toEqual([{ type: 'success', message: 'http://domain.com/_components/a' }, { type: 'success', message: 'http://domain.com/_components/b' }]);
    });
  });

  it('allows multiple files with duplicate bootstrap keys', () => {
    fetch.mockResponseOnce('{}');
    fetch.mockResponseOnce('{}');
    return lib(yaml.dump({ _components: { a: { b: 'c' }} }) + yaml.dump({ _components: { b: { c: 'd' }} }), url, { yaml: true, key, concurrency }).collect().toPromise(Promise).then((res) => {
      expect(res).toEqual([{ type: 'success', message: 'http://domain.com/_components/a' }, { type: 'success', message: 'http://domain.com/_components/b' }]);
    });
  });

  it('imports bootstrap', () => {
    fetch.mockResponseOnce('{}');
    fetch.mockResponseOnce('{}');
    return lib(yaml.dump({
      _layouts: {
        abc: {
          a: 'b'
        }
      },
      _components: {
        article: {
          instances: {
            foo: {
              title: 'My Article',
              content: [{ _ref: '/_components/paragraph/instances/bar' }]
            }
          }
        },
        paragraph: {
          instances: {
            bar: {
              text: 'hello world'
            }
          }
        }
      }
    }), url, { yaml: true, key, concurrency }).collect().toPromise(Promise).then((res) => {
      expect(res).toEqual([{ type: 'success', message: 'http://domain.com/_layouts/abc' }, { type: 'success', message: 'http://domain.com/_components/article/instances/foo' }]);
    });
  });

  it('imports dispatch', () => {
    fetch.mockResponseOnce('{}');
    return lib(JSON.stringify({
      '/_components/article/instances/foo': {
        title: 'My Article',
        content: [{
          _ref: '/_components/paragraphs/instances/bar',
          text: 'hello world'
        }]
      }
    }), url, { key, concurrency }).toPromise(Promise).then((res) => {
      expect(res).toEqual({ type: 'success', message: 'http://domain.com/_components/article/instances/foo' });
    });
  });

  it('publishes items', () => {
    fetch.mockResponseOnce('{}');
    fetch.mockResponseOnce('{}');
    return lib(JSON.stringify({
      '/_components/article/instances/foo': {
        title: 'My Article',
        content: [{
          _ref: '/_components/paragraphs/instances/bar',
          text: 'hello world'
        }]
      }
    }), url, { key, concurrency, publish: true }).collect().toPromise(Promise).then((res) => {
      expect(res).toEqual([{ type: 'success', message: 'http://domain.com/_components/article/instances/foo' }, { type: 'success', message: 'http://domain.com/_components/article/instances/foo@published' }]);
    });
  });

  it('imports uris', () => {
    fetch.mockResponseOnce('domain.com/_pages/foo');
    fetch.mockResponseOnce('{}');
    return lib(JSON.stringify({
      '/_uris/foo': '/_pages/foo'
    }), url, { key }).collect().toPromise(Promise).then((res) => {
      expect(res).toEqual([{ type: 'success', message: 'http://domain.com/_uris/ZG9tYWluLmNvbS9mb28=' }]);
    });
  });

  it('imports layouts', () => {
    fetch.mockResponseOnce('{}');
    fetch.mockResponseOnce('{}');
    return lib(JSON.stringify({
      '/_layouts/foo': {
        head: [{ _ref: '/_components/foo' }]
      }
    }), url, { key }).collect().toPromise(Promise).then((res) => {
      expect(res).toEqual([{ type: 'success', message: 'http://domain.com/_layouts/foo' }]);
    });
  });

  describe('publish ordering', () => {
    const page = 'http://domain.com/_pages/foo',
      layout = 'http://domain.com/_layouts/layout/instances/default',
      article = 'http://domain.com/_components/article/instances/foo',
      paragraph = 'http://domain.com/_components/paragraph/instances/bar',
      // what `clay export -l <page>` emits: the page's components and layout first, the page last
      dispatches = [
        { '/_components/paragraph/instances/bar': { text: 'hello world' } },
        { '/_components/article/instances/foo': { content: [{ _ref: '/_components/paragraph/instances/bar' }] } },
        { '/_layouts/layout/instances/default': { main: 'main' } },
        { '/_pages/foo': { layout: '/_layouts/layout/instances/default', main: ['/_components/article/instances/foo'] } }
      ].map((dispatch) => JSON.stringify(dispatch)).join('\n');

    /**
     * Stand in for Amphora. Drafts land after a short delay (component writes run the
     * component's model.js save, so they are the slowest), and a publish answers 404 when a
     * draft it reads has not landed yet. A page publish reads every draft the page composes,
     * the way amphora's page publish walks the page's components before writing @published.
     * @param  {object} [options]
     * @param  {string[]} [options.failDrafts] draft urls that answer 500
     * @param  {string[]} [options.pageReads] drafts the page publish needs (defaults to the whole tree)
     * @return {string[]} PUT urls in the order Clay received them
     */
    function fakeAmphora({ failDrafts = [], pageReads = [page, layout, article, paragraph] } = {}) {
      const written = new Set(),
        received = [];

      fetch.mockResponse((req) => {
        received.push(req.url);

        if (req.url.endsWith('@published')) {
          const reads = req.url === `${page}@published` ? pageReads : [req.url.replace('@published', '')];

          return Promise.resolve(reads.every((uri) => written.has(uri)) ? '{}' : { status: 404, statusText: 'Not Found', body: '' });
        } else if (failDrafts.includes(req.url)) {
          return Promise.resolve({ status: 500, statusText: 'Internal Server Error', body: '' });
        }

        return new Promise((resolve) => setTimeout(() => {
          written.add(req.url);
          resolve('{}');
        }, req.url.includes('/_components/') ? 20 : 0));
      });

      return received;
    }

    it('publishes a page only after every draft it composes has been written', () => {
      const received = fakeAmphora();

      return lib(dispatches, url, { key, concurrency: 10, publish: true }).collect().toPromise(Promise).then((res) => {
        const lastDraft = Math.max(...[paragraph, article, layout, page].map((uri) => received.indexOf(uri)));

        expect(res.filter((result) => result.type === 'error')).toEqual([]);
        expect(received.indexOf(`${page}@published`)).toBeGreaterThan(lastDraft);
      });
    });

    it('publishes components and layouts before pages', () => {
      const received = fakeAmphora();

      return lib(dispatches, url, { key, concurrency: 10, publish: true }).collect().toPromise(Promise).then(() => {
        const pagePublish = received.indexOf(`${page}@published`);

        [paragraph, article, layout].forEach((uri) => {
          expect(received.indexOf(`${uri}@published`)).toBeGreaterThan(-1);
          expect(received.indexOf(`${uri}@published`)).toBeLessThan(pagePublish);
        });
        expect(received[received.length - 1]).toBe(`${page}@published`);
      });
    });

    it('does not publish an item whose draft failed to import', () => {
      const received = fakeAmphora({ failDrafts: [article] });

      return lib(dispatches, url, { key, concurrency: 10, publish: true }).collect().toPromise(Promise).then((res) => {
        expect(received).not.toContain(`${article}@published`);
        expect(res).toContainEqual({ type: 'error', details: article, message: 'Internal Server Error' });
        // the page still publishes, and Amphora's refusal (its article is missing) is reported
        expect(res).toContainEqual({ type: 'error', details: `${page}@published`, message: 'Not Found' });
      });
    });

    it('publishes bootstrap pages after their drafts', () => {
      // a bootstrap inlines child component data into its parent's dispatch, so the page reads three drafts
      const received = fakeAmphora({ pageReads: [page, layout, article] });

      return lib(yaml.dump({
        _components: { article: { instances: { foo: { content: [{ _ref: '/_components/paragraph/instances/bar', text: 'hello world' }] } } } },
        _layouts: { layout: { instances: { default: { main: 'main' } } } },
        _pages: { foo: { layout: '/_layouts/layout/instances/default', main: ['/_components/article/instances/foo'] } }
      }), url, { yaml: true, key, concurrency: 10, publish: true }).collect().toPromise(Promise).then((res) => {
        expect(res.filter((result) => result.type === 'error')).toEqual([]);
        expect(received[received.length - 1]).toBe(`${page}@published`);
      });
    });
  });

  describe('parseBootstrap', () => {
    const fn = lib.parseBootstrap;

    it('returns error if bad YAML', () => {
      return fn(yaml.dump({ a: 'hi' }) + 'a', url).toPromise(Promise).catch((e) => {
        expect(e.message).toMatch(/^YAML syntax error/);
      });
    });

    it('parses single bootstrap into dispatch, adding prefixes', () => {
      return fn(yaml.dump({ _components: { a: { b: 'c' }} }), url).collect().toPromise(Promise).then((res) => {
        expect(res).toEqual([ { 'domain.com/_components/a': { b: 'c' } } ]);
      });
    });

    it('parses single bootstrap with child components into dispatch, adding prefixes', () => {
      return fn(yaml.dump({
        _components: {
          a: {
            a: 'b',
            children: [{ _ref: '/_components/b' }]
          },
          b: {
            c: 'd'
          }
        }
      }), url).collect().toPromise(Promise).then((res) => {
        expect(res).toEqual([ { 'domain.com/_components/a': { a: 'b', children: [{ _ref: 'domain.com/_components/b', c: 'd' }] } } ]);
      });
    });
  });

  describe('parseBootstrapObject', () => {
    const fn = lib.parseBootstrapObject;

    it('parses single bootstrap into dispatch, adding prefixes', () => {
      return fn({ _components: { a: { b: 'c' }} }, url).collect().toPromise(Promise).then((res) => {
        expect(res).toEqual([ { 'domain.com/_components/a': { b: 'c' } } ]);
      });
    });

    it('parses single bootstrap with child components into dispatch, adding prefixes', () => {
      return fn({
        _components: {
          a: {
            a: 'b',
            children: [{ _ref: '/_components/b' }]
          },
          b: {
            c: 'd'
          }
        }
      }, url).collect().toPromise(Promise).then((res) => {
        expect(res).toEqual([ { 'domain.com/_components/a': { a: 'b', children: [{ _ref: 'domain.com/_components/b', c: 'd' }] } } ]);
      });
    });
  });

  describe('parseDispatch', () => {
    const fn = lib.parseDispatch;

    it('returns error if bad json', () => {
      return fn(JSON.stringify({ a: 'hi' }) + 'a', url).toPromise(Promise).catch((e) => {
        expect(e.message).toMatch(/^JSON parser error:/);
      });
    });

    it('adds prefixes to a single dispatch', () => {
      return fn(JSON.stringify({ '/_components/a': { b: 'c' } }), url).collect().toPromise(Promise).then((res) => {
        expect(res).toEqual([ { 'domain.com/_components/a': { b: 'c' } } ]);
      });
    });

    it('adds prefixes to multiple dispatches', () => {
      return fn(JSON.stringify({ '/_components/a': { b: 'c' } }) + '\n' + JSON.stringify({ '/_components/b': { c: 'd' } }), url).collect().toPromise(Promise).then((res) => {
        expect(res).toEqual([ { 'domain.com/_components/a': { b: 'c' } }, { 'domain.com/_components/b': { c: 'd' } } ]);
      });
    });

    it('adds prefixes to dispatches with children', () => {
      return fn(JSON.stringify({ '/_components/a': { a: 'b', children: [{ _ref: '/_components/b', c: 'd' }] } }), url).collect().toPromise(Promise).then((res) => {
        expect(res).toEqual([ { 'domain.com/_components/a': { a: 'b', children: [{ _ref: 'domain.com/_components/b', c: 'd' }] } } ]);
      });
    });
  });
});

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
      expect(res).toEqual({ type: 'error', message: 'JSON syntax error: Unexpected token ] in JSON at position 0', details: ']{"a":}' });
    });
  });

  it('returns error if bad YAML', () => {
    return lib(yaml.safeDump({ a: 'hi' }) + 'a', url, { yaml: true }).toPromise(Promise).then((res) => {
      expect(res).toEqual({ type: 'error', message: 'YAML syntax error: can not read a block mapping entry; a multiline key may not be an implicit key at line 3, column 1' });
    });
  });

  it('imports bootstrap from stream', () => {
    fetch.mockResponseOnce('{}');
    return lib(h.of(yaml.safeDump({ _components: { a: { b: 'c' }} })), url, { yaml: true, key, concurrency }).collect().toPromise(Promise).then((res) => {
      expect(res).toEqual([{ type: 'success', message: 'http://domain.com/_components/a' }]);
    });
  });

  it('adds warning when importing @published item', () => {
    fetch.mockResponseOnce('{}');
    fetch.mockResponseOnce('{}');
    return lib(h.of(yaml.safeDump({ _components: { a: { instances: { 'b@published': { c: 'd' }} }} })), url, { yaml: true, publish: true, key, concurrency }).collect().toPromise(Promise).then((res) => {
      expect(res).toEqual([{ type: 'success', message: 'http://domain.com/_components/a/instances/b' }, { type: 'success', message: 'http://domain.com/_components/a/instances/b@published' }, { type: 'warning', message: 'Generated latest data for @published item', details: 'http://domain.com/_components/a/instances/b@published' }]);
    });
  });

  it('imports dispatch from stream', () => {
    fetch.mockResponseOnce('{}');
    return lib(h.of(JSON.stringify({ '/_components/a': { b: 'c' } })), url, { key, concurrency }).collect().toPromise(Promise).then((res) => {
      expect(res).toEqual([{ type: 'success', message: 'http://domain.com/_components/a' }]);
    });
  });

  it('allows multiple files with `tail -n +1 filenames` splitter', () => {
    fetch.mockResponseOnce('{}');
    fetch.mockResponseOnce('{}');
    return lib('\n==> ../path/to/doc2.yml <==\n' + yaml.safeDump({ _components: { a: { b: 'c' }} }) + '\n==> ../path/to/doc2.yml <==\n' + yaml.safeDump({ _components: { b: { c: 'd' }} }), url, { yaml: true, key, concurrency }).collect().toPromise(Promise).then((res) => {
      expect(res).toEqual([{ type: 'success', message: 'http://domain.com/_components/a' }, { type: 'success', message: 'http://domain.com/_components/b' }]);
    });
  });

  it('allows multiple files with duplicate bootstrap keys', () => {
    fetch.mockResponseOnce('{}');
    fetch.mockResponseOnce('{}');
    return lib(yaml.safeDump({ _components: { a: { b: 'c' }} }) + yaml.safeDump({ _components: { b: { c: 'd' }} }), url, { yaml: true, key, concurrency }).collect().toPromise(Promise).then((res) => {
      expect(res).toEqual([{ type: 'success', message: 'http://domain.com/_components/a' }, { type: 'success', message: 'http://domain.com/_components/b' }]);
    });
  });

  it('imports bootstrap', () => {
    fetch.mockResponseOnce('{}');
    fetch.mockResponseOnce('{}');
    return lib(yaml.safeDump({
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

  describe('parseBootstrap', () => {
    const fn = lib.parseBootstrap;

    it('returns error if bad YAML', () => {
      return fn(yaml.safeDump({ a: 'hi' }) + 'a', url).toPromise(Promise).catch((e) => {
        expect(e.message).toBe('YAML syntax error: can not read a block mapping entry; a multiline key may not be an implicit key at line 3, column 1');
      });
    });

    it('parses single bootstrap into dispatch, adding prefixes', () => {
      return fn(yaml.safeDump({ _components: { a: { b: 'c' }} }), url).collect().toPromise(Promise).then((res) => {
        expect(res).toEqual([ { 'domain.com/_components/a': { b: 'c' } } ]);
      });
    });

    it('parses single bootstrap with child components into dispatch, adding prefixes', () => {
      return fn(yaml.safeDump({
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

  describe('parseDispatch', () => {
    const fn = lib.parseDispatch;

    it('returns error if bad json', () => {
      return fn(JSON.stringify({ a: 'hi' }) + 'a', url).toPromise(Promise).catch((e) => {
        expect(e.message).toBe('JSON parser error: Unexpected token a in JSON at position 10');
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

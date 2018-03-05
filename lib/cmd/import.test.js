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

  it('returns error if bad JSON', () => {
    return lib('{a}', url).toPromise(Promise).then((res) => {
      expect(res).toEqual({ result: 'error', message: 'JSON syntax error: Unexpected token a in JSON at position 1' });
    });
  });

  it('returns error if bad YAML', () => {
    return lib(yaml.safeDump({ a: 'hi' }) + 'a', url, { yaml: true }).toPromise(Promise).then((res) => {
      expect(res).toEqual({ result: 'error', message: 'YAML syntax error: can not read a block mapping entry; a multiline key may not be an implicit key at line 3, column 1' });
    });
  });

  it('imports bootstrap from stream', () => {
    fetch.mockResponseOnce('{}');
    return lib(h.of(yaml.safeDump({ _components: { a: { b: 'c' }} })), url, { yaml: true, key, concurrency }).collect().toPromise(Promise).then((res) => {
      expect(res).toEqual([{ result: 'success', url: 'http://domain.com/_components/a' }]);
    });
  });

  it('imports dispatch from stream', () => {
    fetch.mockResponseOnce('{}');
    return lib(h.of(JSON.stringify({ '/_components/a': { b: 'c' } })), url, { key, concurrency }).collect().toPromise(Promise).then((res) => {
      expect(res).toEqual([{ result: 'success', url: 'http://domain.com/_components/a' }]);
    });
  });

  it('allows multiple files with `tail -n +1 filenames` splitter', () => {
    fetch.mockResponseOnce('{}');
    fetch.mockResponseOnce('{}');
    return lib('\n==> ../path/to/doc2.yml <==\n' + yaml.safeDump({ _components: { a: { b: 'c' }} }) + '\n==> ../path/to/doc2.yml <==\n' + yaml.safeDump({ _components: { b: { c: 'd' }} }), url, { yaml: true, key, concurrency }).collect().toPromise(Promise).then((res) => {
      expect(res).toEqual([{ result: 'success', url: 'http://domain.com/_components/a' }, { result: 'success', url: 'http://domain.com/_components/b' }]);
    });
  });

  it('imports bootstrap', () => {
    fetch.mockResponseOnce('{}');
    return lib(yaml.safeDump({
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
    }), url, { yaml: true, key, concurrency }).toPromise(Promise).then((res) => {
      expect(res).toEqual({ result: 'success', url: 'http://domain.com/_components/article/instances/foo' });
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
      expect(res).toEqual({ result: 'success', url: 'http://domain.com/_components/article/instances/foo' });
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
      expect(res).toEqual([{ result: 'success', url: 'http://domain.com/_components/article/instances/foo' }, { result: 'success', url: 'http://domain.com/_components/article/instances/foo@published' }]);
    });
  });

  it('imports uris', () => {
    fetch.mockResponseOnce('domain.com/_pages/foo');
    fetch.mockResponseOnce('{}');
    return lib(JSON.stringify({
      '/_uris/foo': '/_pages/foo'
    }), url, { key }).collect().toPromise(Promise).then((res) => {
      expect(res).toEqual([{ result: 'success', url: 'http://domain.com/_uris/ZG9tYWluLmNvbS9mb28=' }]);
    });
  });
});

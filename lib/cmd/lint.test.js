'use strict';
const yaml = require('js-yaml'),
  lib = require('./lint'),
  concurrency = 1000;

describe('lint', () => {
  afterEach(() => {
    fetch.resetMocks();
  });

  describe('lintUrl', () => {
    it('lints with default concurrency', () => {
      fetch.mockResponseOnce('{}');
      return lib.lintUrl('domain.com/_components/foo/instances/bar').toPromise(Promise).then((res) => {
        expect(res).toEqual({ type: 'success', message: 'http://domain.com/_components/foo/instances/bar' });
      });
    });

    it('lints an existing component without children', () => {
      fetch.mockResponseOnce('{}');
      return lib.lintUrl('domain.com/_components/foo/instances/bar', {concurrency}).toPromise(Promise).then((res) => {
        expect(res).toEqual({ type: 'success', message: 'http://domain.com/_components/foo/instances/bar' });
      });
    });

    it('lints a non-existing component without children', () => {
      fetch.mockResponseOnce('{}', { status: 404 }); // .json
      fetch.mockResponseOnce('{}', { status: 404 }); // non-composed data
      return lib.lintUrl('domain.com/_components/foo/instances/bar', {concurrency}).collect().toPromise(Promise).then((res) => {
        expect(res).toEqual([{ type: 'error', message: 'http://domain.com/_components/foo/instances/bar' }]);
      });
    });

    it('lints a component with existing children', () => {
      fetch.mockResponseOnce('{}', { status: 404 }); // .json
      fetch.mockResponseOnce(JSON.stringify({ a: { _ref: 'domain.com/_components/some-child' }, b: { prop: true }, c: 'd' }));
      fetch.mockResponseOnce('{}'); // child
      return lib.lintUrl('domain.com/_components/foo/instances/bar', {concurrency}).collect().toPromise(Promise).then((res) => {
        expect(res).toEqual([{ type: 'success', message: 'http://domain.com/_components/foo/instances/bar' }, { type: 'success', message: 'http://domain.com/_components/some-child' }]);
      });
    });

    it('lints a component with existing children in list', () => {
      fetch.mockResponseOnce('{}', { status: 404 }); // .json
      fetch.mockResponseOnce(JSON.stringify({ a: [{ _ref: 'domain.com/_components/some-child' }], b: [1, 2, 3], c: 'd' }));
      fetch.mockResponseOnce(JSON.stringify({ c: 'd' }));
      return lib.lintUrl('domain.com/_components/foo/instances/bar', {concurrency}).collect().toPromise(Promise).then((res) => {
        expect(res).toEqual([{ type: 'success', message: 'http://domain.com/_components/foo/instances/bar' }, { type: 'success', message: 'http://domain.com/_components/some-child' }]);
      });
    });

    it('lints a component with non-existing children', () => {
      fetch.mockResponseOnce('{}', { status: 404 }); // .json
      fetch.mockResponseOnce(JSON.stringify({ a: { _ref: 'domain.com/_components/some-child' } }));
      fetch.mockResponseOnce('{}', { status: 404 }); // child .json
      fetch.mockResponseOnce('{}', { status: 404 }); // child
      return lib.lintUrl('domain.com/_components/foo/instances/bar', {concurrency}).collect().toPromise(Promise).then((res) => {
        expect(res).toEqual([{ type: 'success', message: 'http://domain.com/_components/foo/instances/bar' }, { type: 'error', message: 'http://domain.com/_components/some-child' }]);
      });
    });

    it('lints a component with existing deep children', () => {
      fetch.mockResponseOnce('{}', { status: 404 }); // .json
      fetch.mockResponseOnce(JSON.stringify({ a: { _ref: 'domain.com/_components/bar' } }));
      fetch.mockResponseOnce('{}', { status: 404 }); // child .json
      fetch.mockResponseOnce(JSON.stringify({ b: { _ref: 'domain.com/_components/baz' } }));
      fetch.mockResponseOnce(JSON.stringify({ c: 'd' })); // grandchild
      return lib.lintUrl('domain.com/_components/foo/instances/bar', {concurrency}).collect().toPromise(Promise).then((res) => {
        expect(res).toEqual([{ type: 'success', message: 'http://domain.com/_components/foo/instances/bar' }, { type: 'success', message: 'http://domain.com/_components/bar' }, { type: 'success', message: 'http://domain.com/_components/baz' }]);
      });
    });

    it('lints a component with non-existing deep children', () => {
      fetch.mockResponseOnce('{}', { status: 404 }); // .json
      fetch.mockResponseOnce(JSON.stringify({ a: { _ref: 'domain.com/_components/bar' } }));
      fetch.mockResponseOnce('{}', { status: 404 }); // child .json
      fetch.mockResponseOnce(JSON.stringify({ b: { _ref: 'domain.com/_components/baz' } }));
      fetch.mockResponseOnce('{}', { status: 404 }); // grandchild .json
      fetch.mockResponseOnce('{}', { status: 404 }); // grandchild
      return lib.lintUrl('domain.com/_components/foo/instances/bar', {concurrency}).collect().toPromise(Promise).then((res) => {
        expect(res).toEqual([{ type: 'success', message: 'http://domain.com/_components/foo/instances/bar' }, { type: 'success', message: 'http://domain.com/_components/bar' }, { type: 'error', message: 'http://domain.com/_components/baz' }]);
      });
    });

    it('lints an existing page with existing children', () => {
      fetch.mockResponseOnce('{}'); // response doesn't matter
      return lib.lintUrl('domain.com/_pages/foo', {concurrency}).collect().toPromise(Promise).then((res) => {
        expect(res).toEqual([{ type: 'success', message: 'http://domain.com/_pages/foo' }]);
      });
    });

    it('lints an existing page with non-existing children', () => {
      fetch.mockResponseOnce('{}', { status: 404 }); // page .json
      fetch.mockResponseOnce(JSON.stringify({
        layout: 'domain.com/_components/foo/instances/bar',
        main: ['domain.com/_components/bar/instances/baz']
      })); // page
      fetch.mockResponseOnce(JSON.stringify({ a: 'b' })); // layout .json
      fetch.mockResponseOnce('{}', { status: 404 }); // main .json
      fetch.mockResponseOnce('{}', { status: 404 }); // main
      return lib.lintUrl('domain.com/_pages/foo', {concurrency}).collect().toPromise(Promise).then((res) => {
        expect(res).toEqual([{ type: 'success', message: 'http://domain.com/_pages/foo' }, { type: 'success', message: 'http://domain.com/_components/foo/instances/bar' }, { type: 'error', message: 'http://domain.com/_components/bar/instances/baz' }]);
      });
    });

    it('lints an existing public url with existing children', () => {
      fetch.mockResponseOnce('domain.com/_pages/foo');
      fetch.mockResponseOnce(JSON.stringify('{}'));
      return lib.lintUrl('domain.com/some-slug', {concurrency}).collect().toPromise(Promise).then((res) => {
        expect(res).toEqual([{ type: 'success', message: 'http://domain.com/some-slug' }, { type: 'success', message: 'http://domain.com/_pages/foo' }]);
      });
    });
  });

  describe('lintSchema', () => {
    it('returns error if yaml syntax error', () => {
      return lib.lintSchema(yaml.safeDump({ _description: 'hi' }) + 'a').toPromise(Promise).then((res) => {
        expect(res).toEqual({ type: 'error', message: 'YAML syntax error: can not read a block mapping entry; a multiline key may not be an implicit key at line 3, column 1' });
      });
    });

    it('returns error if no _description', () => {
      return lib.lintSchema(yaml.safeDump({ foo: { _has: 'bar' } })).collect().toPromise(Promise).then((res) => {
        expect(res).toEqual([{ type: 'error', message: 'Schema has no _description' }]);
      });
    });

    it('lints _description', () => {
      return lib.lintSchema(yaml.safeDump({ _description: 'hi' })).toPromise(Promise).then((res) => {
        expect(res).toEqual({ type: 'success' });
      });
    });

    it('returns error if non-camelCased prop', () => {
      return lib.lintSchema(yaml.safeDump({ _description: 'hi', 'foo-bar': { _has: 'baz' } })).collect().toPromise(Promise).then((res) => {
        expect(res).toEqual([{ type: 'error', message: 'Properties must be camelCased', details: 'foo-bar' }]);
      });
    });

    it('lints camelCased prop', () => {
      return lib.lintSchema(yaml.safeDump({ _description: 'hi', fooBar: { _has: 'baz' } })).toPromise(Promise).then((res) => {
        expect(res).toEqual({ type: 'success' });
      });
    });

    it('returns error if non-existant group fields', () => {
      return lib.lintSchema(yaml.safeDump({ _description: 'hi', _groups: { foo: { fields: ['bar'] } } })).collect().toPromise(Promise).then((res) => {
        expect(res).toEqual([{ type: 'error', message: 'Fields referenced by groups don\'t exist', details: 'foo » bar' }]);
      });
    });

    it('lints existing group fields', () => {
      return lib.lintSchema(yaml.safeDump({ _description: 'hi', bar: { _has: 'baz' }, _groups: { foo: { fields: ['bar'] } } })).toPromise(Promise).then((res) => {
        expect(res).toEqual({ type: 'success' });
      });
    });
  });
});

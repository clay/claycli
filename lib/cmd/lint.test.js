'use strict';
const lib = require('./lint'),
  concurrency = 1000;

describe('lint', () => {
  afterEach(() => {
    fetch.resetMocks();
  });

  describe('lintUrl', () => {
    it('lints with default concurrency', () => {
      fetch.mockResponseOnce(JSON.stringify({ a: 'b' }));
      return lib.lintUrl('domain.com/_components/foo/instances/bar').toPromise(Promise).then((res) => {
        expect(res).toEqual({ result: 'success' });
      });
    });

    it('lints an existing component without children', () => {
      fetch.mockResponseOnce(JSON.stringify({ a: 'b' }));
      return lib.lintUrl('domain.com/_components/foo/instances/bar', {concurrency}).toPromise(Promise).then((res) => {
        expect(res).toEqual({ result: 'success' });
      });
    });

    it('lints a non-existing component without children', () => {
      fetch.mockResponseOnce('{}', { status: 404 });
      return lib.lintUrl('domain.com/_components/foo/instances/bar', {concurrency}).toPromise(Promise).then((res) => {
        expect(res).toEqual({ result: 'error', url: 'http://domain.com/_components/foo/instances/bar' });
      });
    });

    it('lints a component with existing children', () => {
      fetch.mockResponseOnce(JSON.stringify({ a: { _ref: 'domain.com/_components/some-child' }, b: { prop: true } }));
      fetch.mockResponseOnce(JSON.stringify({ c: 'd' }));
      return lib.lintUrl('domain.com/_components/foo/instances/bar', {concurrency}).collect().toPromise(Promise).then((res) => {
        expect(res).toEqual([{ result: 'success' }, { result: 'success' }]);
      });
    });

    it('lints a component with existing children in list', () => {
      fetch.mockResponseOnce(JSON.stringify({ a: [{ _ref: 'domain.com/_components/some-child' }], b: [1, 2, 3] }));
      fetch.mockResponseOnce(JSON.stringify({ c: 'd' }));
      return lib.lintUrl('domain.com/_components/foo/instances/bar', {concurrency}).collect().toPromise(Promise).then((res) => {
        expect(res).toEqual([{ result: 'success' }, { result: 'success' }]);
      });
    });

    it('lints a component with non-existing children', () => {
      fetch.mockResponseOnce(JSON.stringify({ a: { _ref: 'domain.com/_components/some-child' } }));
      fetch.mockResponseOnce('{}', { status: 404 });
      return lib.lintUrl('domain.com/_components/foo/instances/bar', {concurrency}).collect().toPromise(Promise).then((res) => {
        expect(res).toEqual([{ result: 'success' }, { result: 'error', url: 'http://domain.com/_components/some-child' }]);
      });
    });

    it('lints a component with existing deep children', () => {
      fetch.mockResponseOnce(JSON.stringify({ a: { _ref: 'domain.com/_components/bar' } }));
      fetch.mockResponseOnce(JSON.stringify({ b: { _ref: 'domain.com/_components/baz' } }));
      fetch.mockResponseOnce(JSON.stringify({ c: 'd' }));
      return lib.lintUrl('domain.com/_components/foo/instances/bar', {concurrency}).collect().toPromise(Promise).then((res) => {
        expect(res).toEqual([{ result: 'success' }, { result: 'success' }, { result: 'success' }]);
      });
    });

    it('lints a component with non-existing deep children', () => {
      fetch.mockResponseOnce(JSON.stringify({ a: { _ref: 'domain.com/_components/bar' } }));
      fetch.mockResponseOnce(JSON.stringify({ b: { _ref: 'domain.com/_components/baz' } }));
      fetch.mockResponseOnce('{}', { status: 404 });
      return lib.lintUrl('domain.com/_components/foo/instances/bar', {concurrency}).collect().toPromise(Promise).then((res) => {
        expect(res).toEqual([{ result: 'success' }, { result: 'success' }, { result: 'error', url: 'http://domain.com/_components/baz' }]);
      });
    });

    it('lints an existing page with existing children', () => {
      fetch.mockResponseOnce(JSON.stringify({
        layout: 'domain.com/_components/foo/instances/bar',
        main: ['domain.com/_components/bar/instances/baz']
      }));
      fetch.mockResponseOnce(JSON.stringify({ a: 'b' }));
      fetch.mockResponseOnce(JSON.stringify({ c: 'd' }));
      return lib.lintUrl('domain.com/_pages/foo', {concurrency}).collect().toPromise(Promise).then((res) => {
        expect(res).toEqual([{ result: 'success' }, { result: 'success' }, { result: 'success' }]);
      });
    });

    it('lints an existing page with non-existing children', () => {
      fetch.mockResponseOnce(JSON.stringify({
        layout: 'domain.com/_components/foo/instances/bar',
        main: ['domain.com/_components/bar/instances/baz']
      }));
      fetch.mockResponseOnce(JSON.stringify({ a: 'b' }));
      fetch.mockResponseOnce('{}', { status: 404 });
      return lib.lintUrl('domain.com/_pages/foo', {concurrency}).collect().toPromise(Promise).then((res) => {
        expect(res).toEqual([{ result: 'success' }, { result: 'success' }, { result: 'error', url: 'http://domain.com/_components/bar/instances/baz' }]);
      });
    });

    it('lints an existing public url with existing children', () => {
      fetch.mockResponseOnce('domain.com/_pages/foo');
      fetch.mockResponseOnce(JSON.stringify({
        layout: 'domain.com/_components/foo/instances/bar',
        main: ['domain.com/_components/bar/instances/baz']
      }));
      fetch.mockResponseOnce(JSON.stringify({ a: 'b' }));
      fetch.mockResponseOnce(JSON.stringify({ c: 'd' }));
      return lib.lintUrl('domain.com/some-slug', {concurrency}).collect().toPromise(Promise).then((res) => {
        expect(res).toEqual([{ result: 'success' }, { result: 'success' }, { result: 'success' }]);
      });
    });
  });
});

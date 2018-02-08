'use strict';

const _ = require('lodash'),
  lib = require('./deep-reduce'),
  refProp = '_ref',
  ref = 'domain.com/_components/foo',
  component = {
    [refProp]: ref,
    a: 'b'
  },
  compose = (obj) => (str, data) => obj[str] = data;

describe('deep reduce', () => {
  it('calls fn when it finds a component', () => {
    let obj = {};

    _.reduce([component], (result, val) => lib(result, val, compose(obj)), {});
    expect(obj).to.deep.equal({ [ref]: component });
  });

  it('does not call fn on non-component refs', () => {
    let obj = {};

    _.reduce([{ [refProp]: 'domain.com/_pages/foo' }], (result, val) => lib(result, val, compose(obj)), {});
    expect(obj).to.deep.equal({});
  });

  it('does not call fn on ignored keys', () => {
    let obj = {};

    _.reduce([{ locals: component }], (result, val) => lib(result, val, compose(obj)), {});
    expect(obj).to.deep.equal({});
  });

  // note: keys beginning with underscores are metadata, e.g. _layoutRef, _components
  it('does not call fn on keys beginning with underscores', () => {
    let obj = {};

    _.reduce([{ _components: component }], (result, val) => lib(result, val, compose(obj)), {});
    expect(obj).to.deep.equal({});
  });

  it('calls fn on keys containing underscores (not beginning)', () => {
    let obj = {};

    _.reduce([{ cool_components: component }], (result, val) => lib(result, val, compose(obj)), {});
    expect(obj).to.deep.equal({ [ref]: component });
  });

  it('recursively calls itself on objects', () => {
    let obj = {};

    _.reduce([{ a: component }], (result, val) => lib(result, val, compose(obj)), {});
    expect(obj).to.deep.equal({ [ref]: component });
  });

  it('recursively calls itself on arrays', () => {
    let obj = {};

    _.reduce([[component]], (result, val) => lib(result, val, compose(obj)), {});
    expect(obj).to.deep.equal({ [ref]: component });
  });
});

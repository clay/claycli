const fs = require('fs-extra'),
  lib = require('./output-files');

describe('output files', () => {
  let sandbox;

  beforeEach(() => {
    sandbox = sinon.sandbox.create();
    sandbox.stub(fs);
    fs.outputJson.returns(Promise.resolve());
    fs.outputFile.returns(Promise.resolve());
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('saveBootstrap', () => {
    const fn = lib.saveBootstrap,
      filePath = 'path/to/file',
      jsonFile = `${filePath}.json`,
      ymlFile = `${filePath}.yml`,
      yamlFile = `${filePath}.yaml`,
      data = { a: 'b' };

    it('generates bootstrap data with component default data', (done) => {
      fn(jsonFile)([{ '/components/foo': data }]).collect().toCallback((err) => {
        expect(fs.outputJson).to.have.been.calledWith(jsonFile, { components: { foo: data }});
        done(err);
      });
    });

    it('generates bootstrap data with component instance data', (done) => {
      fn(jsonFile)([{ '/components/foo/instances/bar': data }]).collect().toCallback((err) => {
        expect(fs.outputJson).to.have.been.calledWith(jsonFile, { components: { foo: { instances: { bar: data }} }});
        done(err);
      });
    });

    it('generates bootstrap data with component default and instance data', (done) => {
      fn(jsonFile)([{ '/components/foo': data }, { '/components/foo/instances/bar': data }]).collect().toCallback((err) => {
        expect(fs.outputJson).to.have.been.calledWith(jsonFile, { components: { foo: { a: 'b', instances: { bar: data }} }});
        done(err);
      });
    });

    it('generates bootstrap data with component default and instance data, in any order', (done) => {
      fn(jsonFile)([{ '/components/foo/instances/bar': data }, { '/components/foo': data }]).collect().toCallback((err) => {
        expect(fs.outputJson).to.have.been.calledWith(jsonFile, { components: { foo: { a: 'b', instances: { bar: data }} }});
        done(err);
      });
    });

    it('generates bootstrap data for pages, uris, users, lists', (done) => {
      fn(jsonFile)([
        { '/pages/foo': data },
        { '/uris/foo': 'abc' },
        { '/users/foo': data },
        { '/lists/foo': [1, 2, 3] }
      ]).collect().toCallback((err) => {
        expect(fs.outputJson).to.have.been.calledWith(jsonFile, {
          pages: {
            foo: data
          },
          uris: {
            foo: 'abc'
          },
          users: {
            foo: data
          },
          lists: {
            foo: [1, 2, 3]
          }
        });
        done(err);
      });
    });

    it('ignores types we have not specified', (done) => {
      fn(jsonFile)([{ '/foooooooos/foo': data }]).collect().toCallback((err) => {
        expect(fs.outputJson).to.have.been.calledWith(jsonFile, {});
        done(err);
      });
    });

    it('deduplicates chunks', (done) => {
      fn(jsonFile)([{ '/components/foo': data }, { '/components/foo': { c: 'd' }}]).collect().toCallback((err) => {
        expect(fs.outputJson).to.have.been.calledWith(jsonFile, { components: { foo: { c: 'd' } } });
        done(err);
      });
    });

    it('writes to yml if no ext', (done) => {
      fn(filePath)([{ '/components/foo': data }]).collect().toCallback((err) => {
        expect(fs.outputFile).to.have.been.calledWith(ymlFile);
        done(err);
      });
    });

    it('writes to json', (done) => {
      fn(jsonFile)([{ '/components/foo': data }]).collect().toCallback((err) => {
        expect(fs.outputJson).to.have.been.calledWith(jsonFile);
        done(err);
      });
    });

    it('writes to yml', (done) => {
      fn(ymlFile)([{ '/components/foo': data }]).collect().toCallback((err) => {
        expect(fs.outputFile).to.have.been.calledWith(ymlFile);
        done(err);
      });
    });

    it('writes to yaml', (done) => {
      fn(yamlFile)([{ '/components/foo': data }]).collect().toCallback((err) => {
        expect(fs.outputFile).to.have.been.calledWith(yamlFile);
        done(err);
      });
    });

    it('returns success objects when writing json', (done) => {
      fn(jsonFile)([{ '/components/foo': data }]).collect().toCallback((err, res) => {
        expect(res).to.eql([{ result: 'success', filename: jsonFile }]);
        done(err);
      });
    });

    it('emits error objects when writing json', (done) => {
      fs.outputJson.returns(Promise.reject(new Error('nope')));
      fn(jsonFile)([{ '/components/foo': data }]).collect().toCallback((err, res) => {
        expect(res).to.eql([{ result: 'error', filename: jsonFile, message: 'nope' }]);
        done(err);
      });
    });

    it('returns success objects when writing yml', (done) => {
      fn(ymlFile)([{ '/components/foo': data }]).collect().toCallback((err, res) => {
        expect(res).to.eql([{ result: 'success', filename: ymlFile }]);
        done(err);
      });
    });

    it('emits error objects when writing yml', (done) => {
      fs.outputFile.returns(Promise.reject(new Error('nope')));
      fn(ymlFile)([{ '/components/foo': data }]).collect().toCallback((err, res) => {
        expect(res).to.eql([{ result: 'error', filename: ymlFile, message: 'nope' }]);
        done(err);
      });
    });
  });
});

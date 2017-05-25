const isDirectory = require('is-directory'),
  glob = require('glob'),
  fs = require('fs-extra'),
  yaml = require('js-yaml'),
  h = require('highland'),
  lib = require('./input-files');

describe('input files', () => {
  const schemaObj = { _description: 'hi' },
    schemaYml = yaml.safeDump(schemaObj),
    bootstrapObj = {
      components: {
        foo: {
          content: {
            _ref: '/components/bar'
          }
        }
      }
    },
    bootstrapYml = yaml.safeDump(bootstrapObj),
    chunks = {
      '/components/foo': {
        content: { _ref: '/components/bar' }
      }
    },
    schemaPath = process.cwd() + '/foo/schema.yml',
    schemaPath2 = process.cwd() + '/foo/bar/schema.yaml',
    yamlPath = process.cwd() + '/foo/bootstrap.yml',
    jsonPath = process.cwd() + '/foo/bootstrap.json';

  let sandbox;

  beforeEach(() => {
    sandbox = sinon.sandbox.create();
    sandbox.stub(isDirectory, 'sync');
    sandbox.stub(glob, 'sync');
    sandbox.stub(fs); // readFile & readJSON
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('get', () => {
    const fn = lib.get;

    it('emits error if no file', (done) => {
      fs.readFile.returns(Promise.reject(new Error('Not Found')));
      fn('foo.yaml').collect().toCallback((err) => {
        expect(err).to.not.equal(null);
        done();
      });
    });

    it('emits error if unknown path', (done) => {
      isDirectory.sync.returns(false);
      fn('foo').collect().toCallback((err) => {
        expect(err).to.not.equal(null);
        done();
      });
    });

    it('emits error if yaml cannot be parsed', (done) => {
      fs.readFile.returns(Promise.resolve('--- !ruby/object:This::Does::Not::Exist name: foo value: <%= @parameter %>'));
      fn('foo.yml').collect().toCallback((err) => {
        expect(err).to.not.equal(null);
        expect(err.filepath).to.eql('foo.yml');
        done();
      });
    });

    it('gets and parses schema.yml', (done) => {
      fs.readFile.returns(Promise.resolve(schemaYml));
      fn('schema.yml').collect().toCallback((err, data) => {
        expect(data).to.eql([schemaObj]);
        done(err);
      });
    });

    it('gets and parses schema.yaml', (done) => {
      fs.readFile.returns(Promise.resolve(schemaYml));
      fn('schema.yaml').collect().toCallback((err, data) => {
        expect(data).to.eql([schemaObj]);
        done(err);
      });
    });

    it('gets and parses bootstrap.yml', (done) => {
      fs.readFile.returns(Promise.resolve(bootstrapYml));
      fn('bootstrap.yml').collect().toCallback((err, data) => {
        expect(data).to.eql([chunks]);
        done(err);
      });
    });

    it('gets and parses bootstrap.yaml', (done) => {
      fs.readFile.returns(Promise.resolve(bootstrapYml));
      fn('bootstrap.yaml').collect().toCallback((err, data) => {
        expect(data).to.eql([chunks]);
        done(err);
      });
    });

    it('gets and parses bootstrap.json', (done) => {
      fs.readJSON.returns(Promise.resolve(bootstrapObj));
      fn('bootstrap.json').collect().toCallback((err, data) => {
        expect(data).to.eql([chunks]);
        done(err);
      });
    });

    it('gets and parses folder', (done) => {
      const schemaPath = process.cwd() + '/foo/schema.yml',
        yamlPath = process.cwd() + '/foo/bootstrap.yml',
        jsonPath = process.cwd() + '/foo/bootstrap.json';

      isDirectory.sync.returns(true);
      glob.sync.withArgs('schema.+(yml|yaml)').returns(['schema.yml']);
      glob.sync.withArgs('!(schema).+(yml|yaml)').returns(['bootstrap.yml']);
      glob.sync.withArgs('*.json').returns(['bootstrap.json']);
      fs.readFile.withArgs(schemaPath).returns(Promise.resolve(schemaYml));
      fs.readFile.withArgs(yamlPath).returns(Promise.resolve(bootstrapYml));
      fs.readJSON.withArgs(jsonPath).returns(Promise.resolve(bootstrapObj));
      fn('foo').collect().toCallback((err, data) => {
        expect(data).to.eql([{ [schemaPath]: schemaObj }, chunks, chunks]);
        done(err);
      });
    });

    it('gets and parses folder recursively', (done) => {
      isDirectory.sync.returns(true);
      glob.sync.withArgs('**/schema.+(yml|yaml)').returns(['schema.yml', 'bar/schema.yaml']);
      glob.sync.withArgs('**/!(schema).+(yml|yaml)').returns(['bootstrap.yml']);
      glob.sync.withArgs('**/*.json').returns(['bootstrap.json']);
      fs.readFile.withArgs(schemaPath).returns(Promise.resolve(schemaYml));
      fs.readFile.withArgs(schemaPath2).returns(Promise.resolve(schemaYml));
      fs.readFile.withArgs(yamlPath).returns(Promise.resolve(bootstrapYml));
      fs.readJSON.withArgs(jsonPath).returns(Promise.resolve(bootstrapObj));
      fn('foo', true).collect().toCallback((err, data) => {
        expect(data).to.eql([{ [schemaPath]: schemaObj }, chunks, chunks, { [schemaPath2]: schemaObj }]);
        done(err);
      });
    });
  });

  describe('omitSchemas', () => {
    const fn = lib.omitSchemas;

    it('omits schemas from a stream of schemas and bootstraps', (done) => {
      h([{ [schemaPath]: schemaObj }, chunks, chunks, { [schemaPath2]: schemaObj }])
        .filter(fn)
        .collect()
        .toCallback((err, data) => {
          expect(data).to.eql([chunks, chunks]);
          done(err);
        });
    });
  });
});

const h = require('highland'),
  lib = require('./stream-util');

describe('stream-util', function () {

  describe('createStream', function () {
    const fn = lib[this.title];

    it ('returns a stream of items if given an array', function (done) {
      fn([1,2,3]).collect().toCallback((err, data) => {
        if (err) return done(err);
        expect(data).to.eql([1,2,3]);
        done();
      });
    });

    it ('returns input if given a stream', function (done) {
      const stream = h([1,2,3]),
        returned = fn(stream);

      expect(returned).to.equal(stream);
      returned.collect().toCallback((err, data) => {
        if (err) return done(err);
        expect(data).to.eql([1,2,3]);
        done();
      });
    });

    it ('returns a stream with the input if given a non-array', function (done) {
      fn(1).collect().toCallback((err, data) => {
        if (err) return done(err);
        expect(data).to.eql([1]);
        done();
      });
    });
  });
});

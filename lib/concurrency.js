'use strict';

/**
 * create a concurrency limiter (like p-limit, but CJS-compatible)
 * @param  {number} concurrency max parallel tasks
 * @return {function} limit(fn) => Promise
 */
function pLimit(concurrency) {
  var active = 0,
    queue = [];

  function next() {
    if (queue.length > 0 && active < concurrency) {
      queue.shift()();
    }
  }

  return function limit(fn) {
    return new Promise(function (resolve, reject) {
      function run() {
        active++;
        fn().then(resolve, reject).finally(function () {
          active--;
          next();
        });
      }

      if (active < concurrency) {
        run();
      } else {
        queue.push(run);
      }
    });
  };
}

/**
 * process an array with bounded concurrency, preserving order
 * @param  {array}    items
 * @param  {number}   concurrency
 * @param  {function} fn async (item, index) => result
 * @return {Promise<array>} results in original order
 */
function mapConcurrent(items, concurrency, fn) {
  var limit = pLimit(concurrency);

  return Promise.all(items.map(function (item, i) {
    return limit(function () { return fn(item, i); });
  }));
}

module.exports.pLimit = pLimit;
module.exports.mapConcurrent = mapConcurrent;

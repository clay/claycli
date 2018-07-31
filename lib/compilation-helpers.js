'use strict';
const format = require('date-fns/format');

/**
 * determine how long a compilation task took
 * @param  {number} t2 unix timestamp
 * @param  {number} t1 unix timestamp
 * @return {string}
 */
function time(t2, t1) {
  const diff = t2 - t1;

  if (diff > 1000 * 60) {
    // more than a minute (60,000ms)
    return format(new Date(diff), 'm[m] s.SS[s]');
  } else {
    // less than a minute
    return format(new Date(diff), 's.SS[s]');
  }
}

module.exports.time = time;

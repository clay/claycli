'use strict';
const replace = require('string-replace-async'),
  h = require('highland');

/**
 * add prefixes to a stream of dispatches
 * @param {Stream} stream of dispatches
 * @param {string} prefix
 * @returns {Stream}
 */
function add(stream, prefix) {
  return stream.flatMap((dispatch) => {
    return h(replace(dispatch, /"\/_?(components|uris|pages|lists|users)/g, (match, type) => Promise.resolve(`"${prefix}/_${type}`)));
  });
}

/**
 * remove prefixes from a stream of dispatches
 * @param  {stream} stream of dispatches
 * @param  {string} prefix
 * @return {Stream}
 */
function remove(stream, prefix) {
  return stream.flatMap((dispatch) => {
    return h(replace(dispatch, new RegExp(`"${prefix}`, 'g'), '"'));
  });
}

module.exports.add = add;
module.exports.remove = remove;

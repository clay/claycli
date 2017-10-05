const h = require('highland'),
  _ = require('lodash');

/**
 * create stream from items
 * items are either a stream, an array of things, or an individual things
 * @param  {Stream|array|*} items
 * @return {Stream}
 */
function createStream(items) {
  if (h.isStream(items)) {
    return items;
  } else if (_.isArray(items)) {
    return h(items);
  } else {
    return h([items]);
  }
}

module.exports.createStream = createStream;

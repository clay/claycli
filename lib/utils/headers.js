/**
 *
 * @param {object} argv
 * @param {string|Array} [argv.headers] e.g. `key:val`
 * @returns {object} headers object for request
 * @throws on unknown header format
 */
function getYargHeaders(argv) {
  var headers = argv.headers || [];

  if (typeof headers === 'string') {
    headers = [headers];
  }
  return headers.reduce((obj, header) => {
    const split = header.split(':');

    if (split.length !== 2) {
      throw new Error(`Unknown header format: ${header}`);
    }
    obj[split[0].trim()] = split[1].trim();
    return obj;
  }, {});
}

module.exports.getYargHeaders = getYargHeaders;

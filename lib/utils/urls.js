const nodeUrl = require('url');

module.exports.urlToUri = (url) => {
  const parts = nodeUrl.parse(url);

  return parts.hostname + parts.pathname;
};

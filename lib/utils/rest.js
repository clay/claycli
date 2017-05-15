const fetch = require('./fetch'),
  bluebird = require('bluebird'),
  contentHeader = 'Content-Type',
  contentJSON = 'application/json; charset=UTF-8',
  contentText = 'text/plain; charset=UTF-8';

fetch.Promise = bluebird;

function catchError(error) {
  return { statusText: error.message };
}

function checkStatus(url) {
  return (res) => {
    if (res.status && res.status >= 200 && res.status < 400) {
      return res;
    } else if (res.url && res.url !== url) {
      // login redirect!
      let error = new Error('Not Authorized');

      error.response = res;
      throw error;
    } else {
      // some other error
      let error = new Error(res.statusText);

      error.response = res;
      throw error;
    }
  };
}

function send(url, options) {
  return fetch.send(url, options)
    .catch(catchError)
    .then(checkStatus(url));
}

module.exports.get = (url) => send(url, { method: 'GET' }).then((res) => res.json());

module.exports.getText = (url) => send(url, { method: 'GET' }).then((res) => res.text());

module.exports.put = (url, data) => send(url, {
  method: 'PUT',
  body: JSON.stringify(data),
  headers: {
    [contentHeader]: contentJSON
  }
}).then((res) => res.json());

module.exports.putText = (url, data) => send(url, {
  method: 'PUT',
  body: data,
  headers: {
    [contentHeader]: contentText
  }
}).then((res) => res.text());

'use strict';

const _ = require('lodash'),
  b64 = require('base-64'),
  h = require('highland'),
  bluebird = require('bluebird'),
  asyncReplace = require('replace-async'),
  urlUtil = require('../utils/urls'),
  deepReduce = require('../utils/deep-reduce'),
  normalize = require('../utils/normalize-components'),
  refProp = '_ref',
  types = [
    '/_components',
    '/_uris',
    '/_pages',
    '/_lists',
    '/_users'
  ];

/**
 * replace all refs in a stringified json with a new prefix
 * @param  {string} str
 * @param  {string} prefix
 * @return {Promise}
 */
function replace(str, prefix) {
  return new bluebird((resolve, reject) => {
    asyncReplace(str, /"_ref":"(.*?)\/_components/g, `"_ref":"${prefix}/_components`, (err, result) => {
      /* istanbul ignore if: errors only occur when using a replacement function */
      if (err) {
        reject(err);
      } else {
        resolve(result);
      }
    });
  });
}

/**
 * strip prefix
 * note: pass through things that aren't prefixable
 * @param  {string} uri
 * @return {string}
 */
function stripPrefix(uri) {
  let bareUri;

  _.forEach(types, (type) => {
    if (_.includes(uri, type)) {
      bareUri = uri.substring(uri.indexOf(type));
      return false; // end early
    }
  });

  if (!bareUri) {
    // not a real uri, pass it through
    bareUri = uri;
  }

  return bareUri;
}

function addPrefix(prefix, uri, key) {
  let prefixedUri;

  _.forEach(types, (type) => {
    if (_.includes(uri, type)) {
      if (type === '/_uris') {
        let encoded = _.last(uri.split('/_uris/'));

        prefixedUri = prefix + '/_uris/' + b64.encode(prefix + encoded);
      } else {
        prefixedUri = prefix + uri;
      }
      return false; // end early
    } else if (key === 'customUrl') {
      prefixedUri = prefix + uri;
    }
  });

  if (!prefixedUri) {
    // not a real uri, pass it through
    prefixedUri = uri;
  }

  return prefixedUri;
}

/**
 * strip prefixes from a potential component list
 * @param  {array} arr which may be component list or just data
 * @param {function} fn to execute against prefixes
 * @return {array}
 */
function toggleListPrefixes(arr, fn) {
  if (_.has(_.head(arr), refProp)) {
    // it's a component list! strip the prefixes
    return _.map(arr, item => toggleReferencePrefixes(item, fn));
  } else if (_.isString(_.head(arr))) {
    // possibly a page list (array of strings)
    // note: other strings will just be passed through
    return _.map(arr, (item) => fn(item));
  } else {
    // just component data, move along
    return arr;
  }
}

/**
 * strip prefixes from a potential component property
 * @param  {object} obj which may be a component prop or just data
 * @param {function} fn to execute against prefixes
 * @return {object}
 */
function togglePropPrefixes(obj, fn) {
  if (_.has(obj, refProp)) {
    // it's a component prop! strip prefixes
    return toggleReferencePrefixes(obj, fn);
  } else {
    // just component data, move along
    return obj;
  }
}

/**
 * toggle prefixes from all component refs in some data
 * @param  {object|string} data will be string for uris
 * @param {function} fn to execute against prefixes
 * @return {object}
 */
function toggleReferencePrefixes(data, fn) {
  if (_.isString(data)) {
    return fn(data);
  } else {
    let initializer = _.isArray(data) ? [] : {};

    return _.reduce(data, (cleanData, val, key) => {
      if (_.isArray(val)) {
        // possibly a component list
        cleanData[key] = toggleListPrefixes(val, fn);
      } else if (_.isObject(val)) {
        // possibly a component prop
        cleanData[key] = togglePropPrefixes(val, fn);
      } else if (_.isString(val)) {
        // possibly a page's layout or customUrl
        cleanData[key] = fn(val, key);
      } else {
        // add any other bits of component data
        cleanData[key] = val;
      }
      return cleanData;
    }, initializer);
  }
}

/**
 * convert uri and data into agnostic chunk
 * note: chunks are designed to be mergeable, but generating chunks from
 * MULTIPLE sites has a possibility of naming collisions
 * @param  {string} uri
 * @param  {*} data
 * @return {object}
 */
function toChunk(uri, data) {
  return {
    [stripPrefix(uri)]: toggleReferencePrefixes(data, stripPrefix)
  };
}

/**
 * convert agnostic chunk into mergeable object of full uris and data
 * note: merging across multiple sites is fine, because these are full uris
 * @param  {string} prefix
 * @param  {*} chunk
 * @return {object}
 */
function fromChunk(prefix, chunk) {
  const uri = Object.keys(chunk)[0],
    data = chunk[uri];

  return {
    [addPrefix(prefix, uri)]: toggleReferencePrefixes(data, addPrefix.bind(null, prefix))
  };
}

/**
 * parse components for default and instance data
 * @param  {object} items
 * @return {object}
 */
function parseComponents(items) {
  return _.reduce(items, (chunks, data, name) => {
    const defaultData = _.omit(data, 'instances');

    if (_.size(defaultData)) {
      chunks.push(toChunk(`/_components/${name}`, defaultData));
    }

    if (data.instances && _.size(data.instances)) {
      chunks = chunks.concat(_.reduce(data.instances, (instanceChunks, instanceData, instanceID) => {
        return instanceChunks.concat(toChunk(`/_components/${name}/instances/${instanceID}`, instanceData));
      }, []));
    }
    return chunks;
  }, []);
}

/**
 * parse users, generating uris
 * @param  {array} items
 * @return {object}
 */
function parseUsers(items) {
  return _.reduce(items, (chunks, user) => {
    const key = `/_users/${b64.encode(user.username.toLowerCase() + '@' + user.provider)}`;

    return chunks.concat({ [key]: user });
  }, []);
}

/**
 * parse users, generating uris
 * @param  {array} items
 * @return {object}
 */
function parsePages(items) {
  return _.reduce(items, (chunks, val, key) => {
    if (key[0] === '/') {
      // fix for pages, which might start with /
      // (lists, users, and other data types don't start with /)
      key = key.slice(1);
    }

    // unpublished pages should not have 'url', but rather 'customUrl'
    if (val.url && !val.customUrl) {
      val.customUrl = val.url;
      delete val.url; // don't pass this through
    }
    return chunks.concat(toChunk(`/_pages/${key}`, val));
  }, []);
}

/**
 * parse uris, pages, lists, users
 * @param  {object} items
 * @param  {string} type
 * @return {object}
 */
function parseArbitraryData(items, type) {
  return _.reduce(items, (chunks, val, key) => {
    if (key[0] === '/') {
      // fix for uris, which always start with /
      // (lists, users, and other data types don't start with /)
      key = key.slice(1);
    }
    return chunks.concat(toChunk(`/${type}/${key}`, val));
  }, []);
}

/**
 * parse a full botostrap object
 * @param  {object} obj
 * @return {Stream} of chunks chunks
 */
function parseObject(obj) {
  // bootstrap objects must have top-level types
  return h(_.reduce(obj, (chunks, items, type) => {
    if (type === '_components') {
      return chunks.concat(parseComponents(items));
    } else if (type === '_users') {
      return chunks.concat(parseUsers(items));
    } else if (type === '_pages') {
      return chunks.concat(parsePages(items));
    } else {
      return chunks.concat(parseArbitraryData(items, type));
    }
  }, []));
}

/**
 * validate chunks
 * chunks must be in the format { uri w/o prefix: value }
 * @param  {object} chunk
 * @throws {Error} if chunk doesn't match our standards
 * @return {object} chunk
 */
function validate(chunk) {
  let foundUriFormat = false,
    uri;

  if (!_.isObject(chunk)) {
    throw new Error(`Data must be an object, not ${typeof chunk}!`);
  }

  if (_.size(chunk) !== 1) {
    throw new Error(`Too many properties (${_.size(chunk)}) on data! Split into a stream of { uri: value }`);
  }

  uri = Object.keys(chunk)[0];

  if (_.head(uri) !== '/') {
    throw new Error('Uris must not contain site prefix!');
  }

  _.forEach(types, (type) => {
    if (_.includes(uri, type)) {
      foundUriFormat = true;
    }
  });

  if (!foundUriFormat) {
    throw new Error(`Unknown type of uri: ${uri}`);
  }

  return chunk;
}

/**
 * quickly replace prefixes in stringified json
 * note: page data will be passed in as an object, so we need to stringify it here
 * @param  {string} prefix
 * @return {function}
 */
function replacePrefixes(prefix) {
  const uriPrefix = urlUtil.urlToUri(prefix);

  return (item) => {
    if (_.isObject(item.data)) {
      // replace prefixes in page data, then return { url, data: string with new prefixes }
      return h.of({
        url: urlUtil.uriToUrl(prefix, item.url),
        // strip the prefixes, add the new prefixes, then stringify
        data: JSON.stringify(toggleReferencePrefixes(toggleReferencePrefixes(item.data, stripPrefix), addPrefix.bind(null, uriPrefix)))
      });
    } else if (_.isString(item.data)) {
      // replace prefixes in stringified json
      return h(replace(item.data, uriPrefix).then((newData) => {
        return {
          url: urlUtil.uriToUrl(prefix, item.url),
          data: newData
        };
      }));
    } else {
      return h.fromError(new Error(`Cannot replace prefixes in data for ${item.url}`));
    }
  };
}

/**
 * parse json from a Clay server into chunks
 * @param  {object} obj
 * @return {Stream}
 */
function parseDeepObject(obj) {
  const uri = urlUtil.urlToUri(obj.url);

  if (_.isString(obj.data)) {
    let components = [],
      deepData;

    // stringified component data
    deepData = JSON.parse(obj.data);

    deepData[refProp] = uri;
    deepReduce(components, deepData, (ref, val) => {
      components.push({ uri: ref, data: normalize(val) });
    });

    return h(components).map((component) => toChunk(component.uri, component.data));
  } else {
    // non-stringified page data
    return h.of(toChunk(uri, obj.data));
  }
}

module.exports.toChunk = toChunk;
module.exports.fromChunk = fromChunk;
// parse a whole 'bootstrap' object into a stream of chunks
module.exports.parseObject = parseObject;
module.exports.validate = validate;
module.exports.replacePrefixes = replacePrefixes;
// parse a whole .json object from the server into a stream of chunks
module.exports.parseDeepObject = parseDeepObject;

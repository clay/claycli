'use strict';
const _ = require('lodash'),
  h = require('highland'),
  yaml = require('js-yaml'),
  utils = require('clayutils'),
  split = require('split-lines'),
  formatting = require('../formatting'),
  prefixes = require('../prefixes'),
  config = require('./config'),
  rest = require('../rest'),
  DEFAULT_CONCURRENCY = 10,
  EXCERPT_LENGTH = 100;

/**
 * determine if url is a _uris route
 * these must be PUT as text, not json
 * @param  {string}  url
 * @return {Boolean}
 */
function isURI(url) {
  return _.includes(url, 'uris/');
}

/**
 * queue an @published PUT to run once every draft in the import has been written
 * an item whose draft PUT failed is not queued: publishing it would publish stale data or
 * nothing at all, and the draft's own error is already in the results
 * @param  {object[]} publishes queue for this import
 * @param  {object} res result of the draft PUT
 * @param  {string} url @published url to PUT
 * @param  {object} [warning] result to report after the publish
 */
function queuePublish(publishes, res, url, warning) {
  if (res.type !== 'error') {
    publishes.push({ url, warning });
  }
}

function sendDispatchToClay(dispatch, prefix, key, options) {
  const rootURI = Object.keys(dispatch)[0],
    url = prefixes.uriToUrl(prefix, rootURI),
    data = dispatch[rootURI];

  if (isURI(url)) {
    // PUT text to /_uris/id
    // note: never PUT to /_uris/id@published
    // note: also remove the trailing slash
    return rest.put(url.replace(/\/$/, ''), data, { key, type: 'text' });
  } else if (options.publish && _.includes(url, '@published')) {
    // user wants to publish something, but isn't importing latest data
    // so make it for them, and publish it (with a warning) after every draft is in
    return rest.put(url.replace('@published', ''), data, { key }).map((res) => {
      queuePublish(options.publishes, res, url, { type: 'warning', message: 'Generated latest data for @published item', details: url });
      return res;
    });
  } else if (options.publish) {
    // PUT to latest now, and to @published after every draft is in (see publishQueued)
    return rest.put(url, data, { key }).map((res) => {
      queuePublish(options.publishes, res, `${url}@published`);
      return res;
    });
  } else {
    // PUT to latest
    return rest.put(url, data, { key });
  }
}

/**
 * PUT a group of queued items to @published, `concurrency` at a time
 * @param  {object[]} items queued publishes
 * @param  {string} key
 * @param  {number} concurrency
 * @return {Stream} results, each followed by its warning (if any)
 */
function publishGroup(items, key, concurrency) {
  return h(items)
    .map((item) => rest.put(item.url, undefined, { key }).concat(item.warning ? h.of(item.warning) : h([])))
    .parallel(concurrency);
}

/**
 * run the queued @published PUTs, after every draft in the import has been written
 *
 * publishing a page makes amphora read every draft the page composes (its layout and
 * components, all the way down), and `clay export` emits those drafts before the page.
 * publishing each item right after its own draft (with `concurrency` dispatches in flight)
 * let a page publish run while its components were still being written, so amphora
 * answered "Not Found" or "Bad Request" and the page stayed unpublished.
 *
 * components and layouts publish first and pages last: a page publish also writes its
 * components' @published data with the page's context (e.g. its url), so it has to be the
 * last write to them
 * @param  {object[]} publishes queue for this import, complete once the drafts have drained
 * @param  {string} key
 * @param  {number} concurrency
 * @return {Stream}
 */
function publishQueued(publishes, key, concurrency) {
  // flatMap defers reading the queue until this stream is pulled, i.e. after the drafts end
  return h([publishes]).flatMap((queue) => {
    const [pages, others] = _.partition(queue, (item) => utils.isPage(item.url));

    return publishGroup(others, key, concurrency).concat(h([pages]).flatMap((group) => publishGroup(group, key, concurrency)));
  });
}

/**
 * import a bootstrap into clay
 * @param  {object} obj
 * @param  {string} prefix
 * @param  {string} key
 * @param  {object} options
 * @param  {object[]} options.publishes queue of deferred @published PUTs
 * @return {Stream}
 */
function importBootstrap(obj, prefix, key, options) {
  return formatting.toDispatch(h.of(obj))
    .flatMap((dispatch) => prefixes.add(dispatch, prefix))
    .flatMap((dispatch) => sendDispatchToClay(dispatch, prefix, key, options));
}

/**
 * import dispatch into clay
 * @param  {object} obj
 * @param  {string} prefix
 * @param  {string} key
 * @param  {object} options
 * @param  {object[]} options.publishes queue of deferred @published PUTs
 * @return {Stream}
 */
function importDispatch(obj, prefix, key, options) {
  return h.of(obj)
    .flatMap((dispatch) => prefixes.add(dispatch, prefix))
    .flatMap((dispatch) => sendDispatchToClay(dispatch, prefix, key, options));
}

/**
 * pair each line with its line number, dropping the empty ones,
 * so an error can say which line of the input it is about
 * @param  {Stream} lines
 * @return {Stream} of { text, line }
 */
function numberLines(lines) {
  let line = 0;

  return lines.map((text) => ({ text, line: ++line })).filter(({ text }) => text);
}

/**
 * format the source when parsing dispatches
 * @param  {string|Buffer|object|Stream} source
 * @return {Stream} of { text, line }, where text is a string (a line of dispatch) or an object
 */
function formatDispatchSource(source) {
  if (_.isString(source)) {
    // handle importing from strings, e.g. when piping files into claycli
    return numberLines(h.of(source).split());
  } else if (Buffer.isBuffer(source)) {
    // handle importing from buffers, e.g. when piping claycli export into claycli import
    return numberLines(h.of(source.toString('utf8')).split());
  } else if (_.isObject(source) && typeof source.pipe !== 'function') {
    // handle importing from objects (that aren't streams), e.g. when programmatically piping claycli export into claycli import
    // note: we're duck-typing for streams by checking if it has a .pipe function
    return h.of({ text: source, line: 1 });
  } else {
    // handle importing from streams of strings
    return numberLines(h(source).split());
  }
}

/**
 * show the part of a line of dispatch the json parser choked on
 * @param  {string} text the line
 * @param  {number} line its number in the input
 * @param  {Error} e from JSON.parse
 * @return {string}
 */
function describeJsonLine(text, line, e) {
  const position = _.toNumber(_.get(/position (\d+)/.exec(e.message), 1)),
    start = _.isFinite(position) ? _.clamp(position - EXCERPT_LENGTH / 2, 0, Math.max(text.length - EXCERPT_LENGTH, 0)) : 0,
    end = start + EXCERPT_LENGTH;

  return `input line ${line}: ${start > 0 ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`;
}

/**
 * describe a yaml bootstrap that failed to parse, and where
 * a bootstrap piped in from stdin is split into one chunk per root key (e.g. _components:),
 * so its line is counted from the start of that chunk
 * @param  {Error} e from js-yaml
 * @param  {string} [chunk] the part of the bootstrap that was parsed, when it's one of several
 * @return {object} { message, details } details being the lines around the error
 */
function describeYamlError(e, chunk) {
  const mark = e.mark,
    reason = e.reason || _.head(e.message.split('\n')),
    root = chunk && _.trim(_.head(chunk.split('\n'))),
    section = root && /^_\w+:$/.test(root) ? ` from the start of the ${root} section` : '';

  return {
    message: `YAML syntax error: ${reason}${mark ? ` (line ${mark.line + 1}, column ${mark.column + 1}${section})` : ''}`,
    details: _.get(mark, 'snippet')
  };
}

/**
 * import data into clay
 * @param  {string|object|Buffer|Stream} str (stream of) bootstraps or dispatches
 * @param  {string} url to import to (must be a site prefix)
 * @param  {Object} [options={}]
 * @param  {string} [options.key] api key or alias
 * @param  {string} [options.concurrency]
 * @param  {boolean} [options.publish]
 * @param  {boolean} [options.yaml]
 * @return {Stream}
 */
function importItems(str, url, options = {}) {
  const concurrency = options.concurrency || DEFAULT_CONCURRENCY,
    key = config.get('key', options.key),
    prefix = config.get('url', url),
    // a copy carries this import's queue of @published PUTs (see publishQueued),
    // so the caller's options object is never written to
    importOptions = _.assign({}, options, { publishes: [] });

  let drafts;

  if (!prefix) {
    // exit early if there's no url
    return h.of({ type: 'error', message: 'URL is not defined! Please specify a site prefix to import to' });
  }

  if (options.yaml) {
    // parse bootstraps
    drafts = (_.isString(str) ? h.of(str) : h(str))
      .splitBy(/\n==> .*? <==\n/ig) // tail -n +1 [file1 file2 ...] | clay import
      .filter((chunk) => chunk && chunk !== '\n')
      .flatMap((str) => {
        // split yaml bootstraps by duplicate root keys (e.g. _components),
        // allowing us to pipe in large numbers of bootstraps without worrying
        // about duplicate keys
        const lines = split(str, { preserveNewlines: true }),
          bootstraps = _.reduce(lines, (bootstraps, line) => {
            const rootProps = [
              '_components:\n',
              '_pages:\n',
              '_users:\n',
              '_uris:\n',
              '_lists:\n',
              '_layouts:\n'
            ];

            if (_.includes(rootProps, line)) {
              // split line into a new bootstrap
              bootstraps.push(line);
            } else {
              // add current line to the currently latest bootstrap
              bootstraps[bootstraps.length - 1] += line;
            }
            return bootstraps;
          }, ['']);

        return h(bootstraps);
      })
      .map((chunk) => {
        try {
          return yaml.load(chunk);
        } catch (e) {
          return _.assign({ type: 'error' }, describeYamlError(e, chunk));
        }
      })
      .filter((chunk) => !!chunk) // filter out emptiness
      .map((obj) => {
        if (obj.type && obj.type === 'error') {
          return h.of(obj); // pass through errors
        } else {
          return importBootstrap(obj, prefix, key, importOptions);
        }
      }).parallel(concurrency);
  } else {
    // parse dispatches
    drafts = formatDispatchSource(str)
      .map(({ text, line }) => {
        try {
          return _.isString(text) ? JSON.parse(text) : text; // allow strings or objects
        } catch (e) {
          try {
            yaml.load(text);
            // user accidentally tried to import dispatches from a yaml file!
            return { type: 'error', message: 'Cannot import dispatch from yaml', details: 'Please use the --yaml argument to import from bootstraps' };
          } catch (otherE) {
            // not yaml, some other issue
            return { type: 'error', message: `JSON syntax error: ${e.message}`, details: describeJsonLine(text, line, e) };
          }
        }
      })
      .map((obj) => {
        if (obj.type && obj.type === 'error') {
          return h.of(obj); // pass through errors
        } else {
          return importDispatch(obj, prefix, key, importOptions);
        }
      }).parallel(concurrency);
  }

  return options.publish ? drafts.concat(publishQueued(importOptions.publishes, key, concurrency)) : drafts;
}

/**
 * parse string of bootstraps,
 * returning a stream of prefixed dispatches
 * @param  {string} str bootstrap
 * @param  {string} url
 * @return {Stream}
 */
function parseBootstrap(str, url) {
  const prefix = config.get('url', url);

  return h.of(str)
    .map(yaml.load)
    .errors((e, push) => {
      const { message, details } = describeYamlError(e);

      push(new Error(details ? `${message}\n${details}` : message));
    })
    .flatMap((obj) => formatting.toDispatch(h.of(obj)))
    .flatMap((dispatch) => prefixes.add(dispatch, prefix));
}

/**
 * parse string of dispatches,
 * returning a string of prefixed dispatches
 * @param  {string} str
 * @param  {string} url
 * @return {Stream}
 */
function parseDispatch(str, url) {
  const prefix = config.get('url', url);

  return numberLines(h.of(str).split())
    .map(({ text, line }) => {
      try {
        return JSON.parse(text);
      } catch (e) {
        e.line = line;
        throw e;
      }
    })
    .errors((e, push) => push(new Error(`JSON parser error: ${e.message} (input line ${e.line})`)))
    .flatMap((dispatch) => prefixes.add(dispatch, prefix));
}

/**
 * parse a json object that is a direct translation
 * of a bootstrap yaml file returning a string
 * of prefixed dispatches
 * @param  {object} obj
 * @param  {string} url
 * @return {Stream}
 */
function parseBootstrapObject(obj, url) {
  const prefix = config.get('url', url);

  return h.of(obj)
    .flatMap(obj => formatting.toDispatch(h.of(obj)))
    .flatMap(dispatch => prefixes.add(dispatch, prefix));
}

module.exports = importItems;
module.exports.parseBootstrap = parseBootstrap;
module.exports.parseDispatch = parseDispatch;
module.exports.parseBootstrapObject = parseBootstrapObject;

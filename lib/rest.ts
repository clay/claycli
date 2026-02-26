import _ from 'lodash';
import https from 'https';

const pluralize = require('pluralize');

const agent = new https.Agent({ rejectUnauthorized: false }); // allow self-signed certs
const CONTENT_TYPES: Record<string, string> = {
  json: 'application/json; charset=UTF-8',
  text: 'text/plain; charset=UTF-8'
};

interface ApiError extends Error {
  response?: Response;
  url?: string;
}

interface ApiResult {
  type: string;
  message: string;
  details?: string;
  url?: string;
  data?: unknown[];
  total?: number;
}

interface RequestOptions {
  key?: string;
  headers?: Record<string, string>;
  type?: string;
}

interface FetchOptions extends RequestInit {
  agent?: https.Agent | null;
}

/**
 * get protocol to determine if we need https agent
 */
function isSSL(url: string): boolean {
  return new URL(url).protocol === 'https:';
}

/**
 * catch errors in api calls
 */
function catchError(error: Error): { statusText: string } {
  return { statusText: error.message };
}

/**
 * check status of api calls
 * note: this happens AFTER catchError, so those errors are dealt with here
 */
function checkStatus(res: Response | { statusText: string }): Response | ApiError {
  if ('status' in res && res.status >= 200 && res.status < 400) {
    return res as Response;
  } else {
    // some other error
    const error: ApiError = new Error((res as { statusText: string }).statusText);

    error.response = res as Response;
    return error;
  }
}

/**
 * perform the http(s) call
 */
function send(url: string, options: FetchOptions): Promise<Response | ApiError> {
  return fetch(url, options as RequestInit)
    .catch(catchError)
    .then(checkStatus);
}

/**
 * GET api call (async)
 */
async function getAsync(url: string, options?: RequestOptions): Promise<unknown> {
  var type: string, res: Response | ApiError;

  options = options || {};
  type = options.type || 'json';
  res = await send(url, {
    method: 'GET',
    headers: options.headers,
    agent: isSSL(url) ? agent : null
  });

  if (res instanceof Error) {
    (res as ApiError).url = url; // capture urls that we error on
    return res;
  }
  return (res as unknown as Record<string, () => Promise<unknown>>)[type]();
}

/**
 * determine body for PUT request
 */
function formatPutBody(data: unknown, type: string): string | undefined {
  if (data && type === 'json') {
    return JSON.stringify(data);
  } else if (data) {
    return data as string;
  }
  return undefined;
}

/**
 * PUT api call (async)
 */
function putAsync(url: string, data: unknown, options?: RequestOptions): Promise<ApiResult> {
  var headers: Record<string, string>, body: string | undefined;

  options = options || {};

  if (!options.key) {
    throw new Error('Please specify API key to do PUT requests against Clay!');
  }

  options.type = options.type || 'json';
  headers = _.assign({
    'Content-Type': CONTENT_TYPES[options.type],
    Authorization: `Token ${options.key}`
  }, options.headers);
  body = formatPutBody(data, options.type);

  return send(url, {
    method: 'PUT',
    body: body,
    headers: headers,
    agent: isSSL(url) ? agent : null
  }).then((res) => {
    if (res instanceof Error) {
      return { type: 'error', details: url, message: res.message };
    }
    return { type: 'success', message: url };
  });
}

/**
 * process elastic query response
 */
function processQueryResponse(res: Response | ApiError, url: string): Promise<ApiResult> {
  if (res instanceof Error) {
    return Promise.resolve({ type: 'error', details: url, message: res.message });
  }

  if (_.includes((res as Response).headers.get('content-type'), 'text/html')) {
    // elastic error, returned as 200 and raw text
    return (res as Response).text().then((str) => ({
      type: 'error',
      message: str.slice(0, str.indexOf(' ::')),
      details: url,
      url
    }));
  }

  return (res as Response).json().then((obj: Record<string, unknown>) => {
    if (_.get(obj, 'hits.total')) {
      return {
        type: 'success',
        message: pluralize('result', _.get(obj, 'hits.total'), true),
        details: url,
        data: _.map(_.get(obj, 'hits.hits', []) as unknown[], (hit: Record<string, unknown>) => _.assign(hit._source, { _id: hit._id })),
        total: _.get(obj, 'hits.total') as number
      };
    }
    // no results!
    return {
      type: 'error',
      message: 'No results',
      details: url,
      url
    };
  });
}

/**
 * POST to an elastic endpoint with a query (async)
 */
function queryAsync(url: string, queryObj: Record<string, unknown>, options?: RequestOptions): Promise<ApiResult> {
  var headers: Record<string, string>;

  options = options || {};

  if (!options.key) {
    throw new Error('Please specify API key to do POST requests against Clay!');
  }

  headers = _.assign({
    'Content-Type': CONTENT_TYPES.json,
    Authorization: `Token ${options.key}`
  }, options.headers);

  return send(url, {
    method: 'POST',
    body: JSON.stringify(queryObj),
    headers: headers,
    agent: isSSL(url) ? agent : null
  }).then((res) => processQueryResponse(res, url));
}

/**
 * try fetching <some prefix>/_uris until it works (or it reaches the bare hostname)
 */
function recursivelyCheckURI(
  currentURL: string,
  publicURI: string,
  options: RequestOptions
): Promise<{ uri: string; prefix: string }> {
  var urlArray = currentURL.split('/'),
    possiblePrefix: string, possibleUrl: string;

  urlArray.pop();
  possiblePrefix = urlArray.join('/');
  possibleUrl = `${possiblePrefix}/_uris/${Buffer.from(publicURI).toString('base64')}`;

  return send(possibleUrl, {
    method: 'GET',
    headers: options.headers,
    agent: isSSL(possibleUrl) ? agent : null
  }).then((res) => (res as Response).text())
    .then((uri) => ({ uri, prefix: possiblePrefix })) // return page uri and the prefix we discovered
    .catch(() => {
      if (possiblePrefix.match(/^https?:\/\/[^\/]*$/)) {
        return Promise.reject(new Error(`Unable to find a Clay api for ${publicURI}`));
      } else {
        return recursivelyCheckURI(possiblePrefix, publicURI, options);
      }
    });
}

/**
 * given a public url, do GET requests against possible api endpoints until <prefix>/_uris is found,
 * then do requests against that until a page uri is resolved
 */
function findURIAsync(url: string, options?: RequestOptions): Promise<{ uri: string; prefix: string }> {
  var parts = new URL(url),
    publicURI = parts.hostname + parts.pathname;

  options = options || {};
  return recursivelyCheckURI(url, publicURI, options);
}

/**
 * determine if url is a proper elastic endpoint prefix (async)
 */
async function isElasticPrefixAsync(url: string): Promise<boolean> {
  var res = await send(`${url}/_components`, {
    method: 'GET',
    agent: isSSL(url) ? agent : null
  });

  return !(res instanceof Error);
}

export {
  getAsync as get,
  putAsync as put,
  queryAsync as query,
  findURIAsync as findURI,
  isElasticPrefixAsync as isElasticPrefix
};

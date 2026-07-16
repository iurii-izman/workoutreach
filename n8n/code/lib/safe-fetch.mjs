import http from 'node:http';
import https from 'node:https';
import { SafeStop } from './errors.mjs';
import { normalizeUrl, resolvePublicHost } from './url-policy.mjs';

const DEFAULTS = Object.freeze({
  maxRedirects: 3,
  timeoutMs: 10_000,
  maxBytes: 2 * 1024 * 1024,
  userAgent: 'WorkoutreachBot/0.1 (+https://workoutreach.invalid/bot)',
});

export function createPinnedLookup(resolved) {
  if (!Array.isArray(resolved) || resolved.length === 0) throw new SafeStop('URL_DNS_EMPTY', 'Pinned DNS result is empty');
  return (_hostname, lookupOptions, callback) => {
    if (lookupOptions?.all) {
      callback(null, resolved.map(({ address, family }) => ({ address, family })));
      return;
    }
    callback(null, resolved[0].address, resolved[0].family);
  };
}

function requestOnce(url, resolved, options) {
  return new Promise((resolve, reject) => {
    const client = url.protocol === 'https:' ? https : http;
    const request = client.request(url, {
      method: 'GET',
      headers: {
        'user-agent': options.userAgent,
        accept: options.accept,
        'accept-encoding': 'identity',
      },
      rejectUnauthorized: true,
      servername: url.hostname,
      lookup: createPinnedLookup(resolved),
    }, (response) => {
      const chunks = [];
      let bytes = 0;
      response.on('data', (chunk) => {
        bytes += chunk.length;
        if (bytes > options.maxBytes) {
          request.destroy(new SafeStop('FETCH_TOO_LARGE', 'Response exceeded the byte budget'));
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => resolve({
        status: response.statusCode ?? 0,
        headers: response.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      }));
    });
    request.setTimeout(options.timeoutMs, () => request.destroy(new SafeStop('FETCH_TIMEOUT', 'Page fetch timed out')));
    request.once('error', reject);
    request.end();
  });
}

export async function safeFetch(input, overrides = {}) {
  const options = { ...DEFAULTS, accept: 'text/html,text/plain;q=0.5', ...overrides };
  let current = normalizeUrl(input);
  const rootHostname = current.hostname;

  for (let redirect = 0; redirect <= options.maxRedirects; redirect += 1) {
    const resolved = await resolvePublicHost(current.hostname, options.lookup);
    const response = await (options.request ?? requestOnce)(current, resolved, options);
    if (Buffer.byteLength(response.body ?? '') > options.maxBytes) throw new SafeStop('FETCH_TOO_LARGE', 'Response exceeded the byte budget');
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      if (redirect === options.maxRedirects) throw new SafeStop('FETCH_REDIRECT_LIMIT', 'Redirect limit exceeded');
      const location = response.headers.location;
      if (!location) throw new SafeStop('FETCH_REDIRECT_INVALID', 'Redirect did not provide a location');
      current = normalizeUrl(new URL(location, current).href);
      if (current.hostname !== rootHostname) throw new SafeStop('FETCH_REDIRECT_CROSS_SITE', 'Redirect changed the approved hostname');
      continue;
    }
    if (response.status < 200 || response.status >= 300) throw new SafeStop('FETCH_HTTP_STATUS', 'Page returned a non-success status', { status: response.status });
    const contentType = String(response.headers['content-type'] ?? '').toLowerCase();
    if (!contentType.startsWith('text/html') && !contentType.startsWith('text/plain')) {
      throw new SafeStop('FETCH_CONTENT_TYPE_BLOCKED', 'Only HTML and safe text responses are allowed', { contentType });
    }
    return { url: current.href, contentType, body: response.body, bytes: Buffer.byteLength(response.body) };
  }
  throw new SafeStop('FETCH_REDIRECT_LIMIT', 'Redirect limit exceeded');
}

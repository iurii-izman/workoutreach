import test from 'node:test';
import assert from 'node:assert/strict';
import { createPinnedLookup, safeFetch } from '../../n8n/code/lib/safe-fetch.mjs';

const publicLookup = async () => [{ address: '93.184.216.34', family: 4 }];

test('revalidates redirect target and blocks redirect to private literal before a second request', async () => {
  let requests = 0;
  await assert.rejects(safeFetch('https://example.com/', {
    lookup: publicLookup,
    request: async () => { requests += 1; return { status: 302, headers: { location: 'http://127.0.0.1/private' }, body: '' }; },
  }), { code: 'URL_LITERAL_IP_BLOCKED' });
  assert.equal(requests, 1);
});

test('blocks a public cross-host redirect before following it', async () => {
  let requests = 0;
  await assert.rejects(safeFetch('https://example.com/', {
    lookup: publicLookup,
    request: async () => { requests += 1; return { status: 302, headers: { location: 'https://other.example/path' }, body: '' }; },
  }), { code: 'FETCH_REDIRECT_CROSS_SITE' });
  assert.equal(requests, 1);
});

test('rejects oversized content even from an injected transport', async () => {
  await assert.rejects(safeFetch('https://example.com/', {
    lookup: publicLookup,
    maxBytes: 10,
    request: async () => ({ status: 200, headers: { 'content-type': 'text/html' }, body: 'x'.repeat(11) }),
  }), { code: 'FETCH_TOO_LARGE' });
});

test('pins the public DNS result passed to the request transport', async () => {
  let observed;
  await safeFetch('https://example.com/', {
    lookup: publicLookup,
    request: async (_url, resolved) => { observed = resolved; return { status: 200, headers: { 'content-type': 'text/html' }, body: '<p>ok</p>' }; },
  });
  assert.deepEqual(observed, [{ address: '93.184.216.34', family: 4 }]);
});

test('pinned lookup supports the Node 24 all-address callback contract', async () => {
  const lookup = createPinnedLookup([{ address: '93.184.216.34', family: 4 }]);
  const all = await new Promise((resolve, reject) => lookup('example.com', { all: true }, (error, result) => error ? reject(error) : resolve(result)));
  assert.deepEqual(all, [{ address: '93.184.216.34', family: 4 }]);
  const one = await new Promise((resolve, reject) => lookup('example.com', {}, (error, address, family) => error ? reject(error) : resolve({ address, family })));
  assert.deepEqual(one, { address: '93.184.216.34', family: 4 });
});

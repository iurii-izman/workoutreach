import test from 'node:test';
import assert from 'node:assert/strict';
import { assertPublicAddress, normalizeUrl, resolvePublicHost } from '../../n8n/code/lib/url-policy.mjs';

test('normalizes a public HTTP URL without inventing fields', () => {
  assert.equal(normalizeUrl('https://Example.COM/about').href, 'https://example.com/about');
});

test('blocks unsafe URL forms before DNS or network access', () => {
  const blocked = [
    'file:///etc/passwd', 'http://user:pass@example.com/', 'https://example.com/#x',
    'http://example.com:8080/', 'http://localhost/', 'http://service.local/',
    'http://127.0.0.1/', 'http://2130706433/', 'http://0x7f000001/', 'http://[::1]/',
    'http://%31%32%37.0.0.1/',
  ];
  for (const value of blocked) assert.throws(() => normalizeUrl(value), { name: 'SafeStop' }, value);
});

test('blocks private, reserved, documentation and link-local addresses', () => {
  for (const address of ['10.0.0.1', '192.168.1.1', '127.0.0.1', '169.254.10.1', '192.0.2.10', '198.51.100.2', '203.0.113.4', '::1', 'fe80::1', 'fc00::1']) {
    assert.throws(() => assertPublicAddress(address), { code: 'URL_ADDRESS_BLOCKED' }, address);
  }
  assert.equal(assertPublicAddress('93.184.216.34'), '93.184.216.34');
});

test('rejects a hostname when any DNS answer is non-public', async () => {
  await assert.rejects(
    resolvePublicHost('example.com', async () => [{ address: '93.184.216.34', family: 4 }, { address: '127.0.0.1', family: 4 }]),
    { code: 'URL_ADDRESS_BLOCKED' },
  );
});

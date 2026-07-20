import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LoginRateLimiter,
  clearSessionCookie,
  createPasswordHash,
  createSession,
  parseCookie,
  sessionCookie,
  verifyPassword,
  verifySession,
} from '../../dashboard/auth.mjs';

test('dashboard password hashes use pinned scrypt parameters and verify safely', async () => {
  const hash = await createPasswordHash('synthetic-password-2026');
  assert.match(hash, /^scrypt\$16384\$8\$1\$/u);
  assert.equal(await verifyPassword('synthetic-password-2026', hash), true);
  assert.equal(await verifyPassword('wrong-password', hash), false);
  assert.equal(await verifyPassword('synthetic-password-2026', 'invalid'), false);
});

test('dashboard sessions are signed, expire and use hardened host-only cookies', () => {
  const secret = 's'.repeat(48);
  const created = createSession(secret, 1_000, 10_000);
  assert.equal(verifySession(created.token, secret, 5_000)?.csrf, created.payload.csrf);
  assert.equal(verifySession(created.token, 'x'.repeat(48), 5_000), null);
  assert.equal(verifySession(created.token, secret, 11_001), null);
  const cookie = sessionCookie(created.token);
  assert.match(cookie, /Secure; HttpOnly; SameSite=Strict/u);
  assert.doesNotMatch(cookie, /Domain=/u);
  assert.equal(parseCookie(cookie, 'workoutreach_session'), created.token);
  assert.match(clearSessionCookie(), /Max-Age=0/u);
});

test('login limiter blocks the sixth failed attempt in its window', () => {
  const limiter = new LoginRateLimiter({ windowMs: 60_000, maximum: 5 });
  for (let attempt = 0; attempt < 5; attempt += 1) {
    assert.equal(limiter.check('local', 1000).allowed, true);
    limiter.failure('local', 1000);
  }
  assert.equal(limiter.check('local', 1000).allowed, false);
  limiter.success('local');
  assert.equal(limiter.check('local', 1000).allowed, true);
});

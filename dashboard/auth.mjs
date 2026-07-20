import { createHmac, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);
const HASH_BYTES = 32;
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;

function equalBuffers(left, right) {
  return left.length === right.length && timingSafeEqual(left, right);
}

export async function createPasswordHash(password) {
  if (typeof password !== 'string' || password.length < 12 || password.length > 200) {
    throw new Error('DASHBOARD_PASSWORD_LENGTH');
  }
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, HASH_BYTES, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: 64 * 1024 * 1024,
  });
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString('base64url')}$${key.toString('base64url')}`;
}

export async function verifyPassword(password, encoded) {
  try {
    const [algorithm, nText, rText, pText, saltText, keyText] = String(encoded).trim().split('$');
    const N = Number(nText);
    const r = Number(rText);
    const p = Number(pText);
    if (algorithm !== 'scrypt' || N !== SCRYPT_N || r !== SCRYPT_R || p !== SCRYPT_P) return false;
    const salt = Buffer.from(saltText, 'base64url');
    const expected = Buffer.from(keyText, 'base64url');
    if (salt.length !== 16 || expected.length !== HASH_BYTES) return false;
    const actual = await scrypt(String(password), salt, expected.length, { N, r, p, maxmem: 64 * 1024 * 1024 });
    return equalBuffers(actual, expected);
  } catch {
    return false;
  }
}

function sign(value, secret) {
  return createHmac('sha256', secret).update(value).digest('base64url');
}

export function createSession(secret, now = Date.now(), ttlMs = 8 * 60 * 60 * 1000) {
  const payload = Buffer.from(JSON.stringify({
    v: 1,
    iat: now,
    exp: now + ttlMs,
    csrf: randomBytes(24).toString('base64url'),
    sid: randomBytes(16).toString('base64url'),
  }), 'utf8').toString('base64url');
  return { token: `${payload}.${sign(payload, secret)}`, payload: JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) };
}

export function verifySession(token, secret, now = Date.now()) {
  try {
    const [payloadText, signatureText, extra] = String(token ?? '').split('.');
    if (!payloadText || !signatureText || extra !== undefined) return null;
    const actual = Buffer.from(signatureText, 'base64url');
    const expected = Buffer.from(sign(payloadText, secret), 'base64url');
    if (!equalBuffers(actual, expected)) return null;
    const payload = JSON.parse(Buffer.from(payloadText, 'base64url').toString('utf8'));
    if (payload.v !== 1 || !Number.isFinite(payload.exp) || payload.exp <= now || typeof payload.csrf !== 'string') return null;
    return payload;
  } catch {
    return null;
  }
}

export function parseCookie(header, name) {
  for (const part of String(header ?? '').split(';')) {
    const separator = part.indexOf('=');
    if (separator < 1) continue;
    if (part.slice(0, separator).trim() === name) return part.slice(separator + 1).trim();
  }
  return null;
}

export function sessionCookie(token, maxAgeSeconds = 8 * 60 * 60) {
  return `workoutreach_session=${token}; Path=/; Max-Age=${maxAgeSeconds}; Secure; HttpOnly; SameSite=Strict`;
}

export function clearSessionCookie() {
  return 'workoutreach_session=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Strict';
}

export class LoginRateLimiter {
  constructor({ windowMs = 15 * 60 * 1000, maximum = 5 } = {}) {
    this.windowMs = windowMs;
    this.maximum = maximum;
    this.attempts = new Map();
  }

  check(key, now = Date.now()) {
    const current = this.attempts.get(key);
    if (!current || current.resetAt <= now) return { allowed: true, retryAfter: 0 };
    if (current.count < this.maximum) return { allowed: true, retryAfter: 0 };
    return { allowed: false, retryAfter: Math.max(1, Math.ceil((current.resetAt - now) / 1000)) };
  }

  failure(key, now = Date.now()) {
    const current = this.attempts.get(key);
    if (!current || current.resetAt <= now) this.attempts.set(key, { count: 1, resetAt: now + this.windowMs });
    else current.count += 1;
  }

  success(key) {
    this.attempts.delete(key);
  }
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { configureGmailEnv, disableGmailEnv, normalizeGoogleAppPassword, parseEnvText } from '../../n8n/code/lib/gmail-config.mjs';

const base = [
  'MAIL_TRANSPORT=disabled',
  'LIVE_SEND_ENABLED=false',
  'SMTP_HOST=smtp.example.com',
  'SMTP_PORT=587',
  'SMTP_USER=owner@gmail.com',
  'SMTP_PASSWORD=must-not-survive',
  'MAIL_FROM_ADDRESS=owner@gmail.com',
  'MAIL_FROM_NAME=Owner',
  'DAILY_SEND_LIMIT=0',
  '',
].join('\n');

test('Google app password accepts grouped input and rejects a normal password', () => {
  assert.equal(normalizeGoogleAppPassword('abcd efgh ijkl mnop'), 'abcdefghijklmnop');
  assert.throws(() => normalizeGoogleAppPassword('ordinary-password'), { code: 'GMAIL_APP_PASSWORD_INVALID' });
});

test('Gmail activation pins TLS submission and owner-approved daily capacity without retaining plaintext password in env', () => {
  const env = parseEnvText(configureGmailEnv(base));
  assert.equal(env.get('MAIL_TRANSPORT'), 'smtp');
  assert.equal(env.get('LIVE_SEND_ENABLED'), 'true');
  assert.equal(env.get('SMTP_HOST'), 'smtp.gmail.com');
  assert.equal(env.get('SMTP_PORT'), '465');
  assert.equal(env.get('DAILY_SEND_LIMIT'), '30');
  assert.equal(env.has('SMTP_PASSWORD'), false);
});

test('Gmail activation refuses mismatched sender identities', () => {
  assert.throws(() => configureGmailEnv(base.replace('MAIL_FROM_ADDRESS=owner@gmail.com', 'MAIL_FROM_ADDRESS=other@gmail.com')), { code: 'GMAIL_SENDER_INVALID' });
});

test('Gmail disable restores all physical mail kill switches and removes env password', () => {
  const env = parseEnvText(disableGmailEnv(configureGmailEnv(base)));
  assert.equal(env.get('MAIL_TRANSPORT'), 'disabled');
  assert.equal(env.get('LIVE_SEND_ENABLED'), 'false');
  assert.equal(env.get('DAILY_SEND_LIMIT'), '0');
  assert.equal(env.has('SMTP_PASSWORD'), false);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertStage2MockSafety,
  createApprovalNonce,
  formatApprovalCallback,
  hashApprovalNonce,
  normalizeRecipientEmail,
  parseApprovalCallback,
  recipientFingerprint,
} from '../../n8n/code/lib/approval.mjs';

test('recipient suppression fingerprint is normalized, keyed and deterministic', () => {
  const key = 'stage-2-synthetic-hmac-key-32-bytes-minimum';
  const first = recipientFingerprint(' Review@Example.COM ', key);
  const second = recipientFingerprint('review@example.com', key);
  assert.match(first, /^[0-9a-f]{64}$/u);
  assert.equal(first, second);
  assert.notEqual(first, recipientFingerprint('other@example.com', key));
  assert.equal(normalizeRecipientEmail(' Review@Example.COM '), 'review@example.com');
});

test('suppression HMAC rejects weak keys and invalid recipients', () => {
  assert.throws(() => recipientFingerprint('review@example.com', 'short'), { code: 'SUPPRESSION_KEY_INVALID' });
  assert.throws(() => recipientFingerprint('not-an-email', 'stage-2-synthetic-hmac-key-32-bytes-minimum'), { code: 'RECIPIENT_INVALID' });
});

test('approval callback round-trips within Telegram 64-byte limit', () => {
  const nonce = createApprovalNonce();
  const callbackData = formatApprovalCallback({ action: 'mock_send', jobId: 'WO-ABC234', nonce });
  assert.ok(Buffer.byteLength(callbackData, 'utf8') <= 64);
  assert.deepEqual(parseApprovalCallback(callbackData), { action: 'mock_send', jobId: 'WO-ABC234', nonce });
  assert.match(hashApprovalNonce(nonce), /^[0-9a-f]{64}$/u);
  assert.throws(() => parseApprovalCallback('mock_send:WO-ABC234:predictable'), { code: 'CALLBACK_INVALID' });
});

test('stage-2 safety gate allows only the physical mock configuration', () => {
  assert.deepEqual(assertStage2MockSafety({
    MAIL_TRANSPORT: 'disabled', LIVE_SEND_ENABLED: 'false', DAILY_SEND_LIMIT: '0',
  }), { mailTransport: 'disabled', liveSendEnabled: false, dailySendLimit: 0, transport: 'mock' });
  assert.throws(() => assertStage2MockSafety({
    MAIL_TRANSPORT: 'smtp', LIVE_SEND_ENABLED: 'false', DAILY_SEND_LIMIT: '0',
  }), { code: 'STAGE2_SAFETY_BLOCK' });
  assert.throws(() => assertStage2MockSafety({
    MAIL_TRANSPORT: 'disabled', LIVE_SEND_ENABLED: 'true', DAILY_SEND_LIMIT: '0',
  }), { code: 'STAGE2_SAFETY_BLOCK' });
});

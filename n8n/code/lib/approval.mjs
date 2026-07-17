import { createHash, createHmac, randomBytes } from 'node:crypto';
import { SafeStop } from './errors.mjs';

const JOB_ID_PATTERN = /^WO-[A-Z0-9]{6}$/u;
const NONCE_PATTERN = /^[A-Za-z0-9_-]{22,43}$/u;
const CALLBACK_PATTERN = /^(mock_send|regenerate|reject|select_recipient):(WO-[A-Z0-9]{6}):([A-Za-z0-9_-]{22,43})$/u;

export function normalizeRecipientEmail(value) {
  const email = String(value ?? '').trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) {
    throw new SafeStop('RECIPIENT_INVALID', 'Recipient email is invalid');
  }
  return email;
}

export function recipientFingerprint(email, hmacKey) {
  if (!(typeof hmacKey === 'string' || Buffer.isBuffer(hmacKey)) || Buffer.byteLength(hmacKey) < 32) {
    throw new SafeStop('SUPPRESSION_KEY_INVALID', 'Suppression HMAC key must contain at least 32 bytes');
  }
  return createHmac('sha256', hmacKey).update(normalizeRecipientEmail(email), 'utf8').digest('hex');
}

export function createApprovalNonce(bytes = 16) {
  if (!Number.isSafeInteger(bytes) || bytes < 16 || bytes > 32) throw new RangeError('Approval nonce must contain 16 to 32 random bytes');
  return randomBytes(bytes).toString('base64url');
}

export function hashApprovalNonce(nonce) {
  if (!NONCE_PATTERN.test(String(nonce ?? ''))) throw new SafeStop('APPROVAL_NONCE_INVALID', 'Approval nonce format is invalid');
  return createHash('sha256').update(nonce, 'utf8').digest('hex');
}

export function formatApprovalCallback({ action = 'mock_send', jobId, nonce }) {
  if (!JOB_ID_PATTERN.test(String(jobId ?? ''))) throw new SafeStop('JOB_ID_INVALID', 'Job ID format is invalid');
  if (!NONCE_PATTERN.test(String(nonce ?? ''))) throw new SafeStop('APPROVAL_NONCE_INVALID', 'Approval nonce format is invalid');
  const callbackData = `${action}:${jobId}:${nonce}`;
  if (!CALLBACK_PATTERN.test(callbackData) || Buffer.byteLength(callbackData, 'utf8') > 64) {
    throw new SafeStop('CALLBACK_INVALID', 'Approval callback is outside the safe contract');
  }
  return callbackData;
}

export function parseApprovalCallback(callbackData) {
  const value = String(callbackData ?? '');
  const match = value.match(CALLBACK_PATTERN);
  if (!match || Buffer.byteLength(value, 'utf8') > 64) throw new SafeStop('CALLBACK_INVALID', 'Approval callback is outside the safe contract');
  return { action: match[1], jobId: match[2], nonce: match[3] };
}

export function assertStage2MockSafety(env = process.env) {
  const mailTransport = env.MAIL_TRANSPORT ?? 'disabled';
  const liveSend = String(env.LIVE_SEND_ENABLED ?? 'false').toLowerCase();
  const dailyLimit = Number(env.DAILY_SEND_LIMIT ?? 0);
  if (mailTransport !== 'disabled' || liveSend !== 'false' || dailyLimit !== 0) {
    throw new SafeStop('STAGE2_SAFETY_BLOCK', 'Stage 2 requires disabled mail, live send false and daily send limit zero');
  }
  return Object.freeze({ mailTransport, liveSendEnabled: false, dailySendLimit: 0, transport: 'mock' });
}

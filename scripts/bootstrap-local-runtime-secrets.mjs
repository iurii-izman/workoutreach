import { randomBytes } from 'node:crypto';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SafeStop } from '../n8n/code/lib/errors.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const target = join(root, '.secrets');
await mkdir(target, { recursive: true });

const required = {
  openai_api_key: process.env.OPENAI_API_KEY,
  telegram_bot_token: process.env.TELEGRAM_BOT_TOKEN,
  telegram_allowed_user_ids: process.env.ALLOWED_TELEGRAM_USER_IDS,
  telegram_allowed_chat_ids: process.env.ALLOWED_TELEGRAM_CHAT_IDS,
  cv_attachment_sha256: process.env.CV_ATTACHMENT_SHA256,
  smtp_user: process.env.SMTP_USER || 'disabled',
  mail_from_address: process.env.MAIL_FROM_ADDRESS || 'disabled',
};

if (!/^sk-[A-Za-z0-9_-]{20,}$/u.test(String(required.openai_api_key ?? ''))) throw new SafeStop('OPENAI_CREDENTIAL_MISSING', 'A usable OpenAI API key is required in ignored .env');
if (!/^\d+:[A-Za-z0-9_-]{20,}$/u.test(String(required.telegram_bot_token ?? ''))) throw new SafeStop('TELEGRAM_CREDENTIAL_MISSING', 'A usable Telegram bot token is required in ignored .env');
if (!/^-?\d+(,-?\d+)*$/u.test(String(required.telegram_allowed_user_ids ?? '')) || !/^-?\d+(,-?\d+)*$/u.test(String(required.telegram_allowed_chat_ids ?? ''))) {
  throw new SafeStop('TELEGRAM_ALLOWLIST_INVALID', 'Numeric Telegram allowlists are required in ignored .env');
}
if (!/^[0-9a-f]{64}$/u.test(String(required.cv_attachment_sha256 ?? '').toLowerCase())) throw new SafeStop('ATTACHMENT_HASH_INVALID', 'CV SHA-256 is required in ignored .env');
if (process.env.LIVE_SEND_ENABLED?.toLowerCase() === 'true') {
  if ((process.env.MAIL_TRANSPORT ?? '') !== 'smtp' || required.smtp_user === 'disabled' || required.mail_from_address === 'disabled') {
    throw new SafeStop('SMTP_CREDENTIAL_MISSING', 'Enabled SMTP requires user and sender address in ignored .env');
  }
}

for (const [name, value] of Object.entries(required)) {
  const path = join(target, name);
  await writeFile(path, `${String(value).trim()}\n`, { encoding: 'utf8', mode: 0o600 });
  await chmod(path, 0o600);
}

const smtpPasswordPath = join(target, 'smtp_password');
const suppliedSmtpPassword = String(process.env.SMTP_PASSWORD ?? '').replace(/\s+/gu, '');
if (suppliedSmtpPassword && suppliedSmtpPassword !== 'disabled') {
  if (Buffer.byteLength(suppliedSmtpPassword) < 12) throw new SafeStop('SMTP_CREDENTIAL_INVALID', 'SMTP app password is too short');
  await writeFile(smtpPasswordPath, `${suppliedSmtpPassword}\n`, { encoding: 'utf8', mode: 0o600 });
} else {
  try {
    const existing = (await readFile(smtpPasswordPath, 'utf8')).trim();
    if (process.env.LIVE_SEND_ENABLED?.toLowerCase() === 'true' && (existing === 'disabled' || Buffer.byteLength(existing) < 12)) {
      throw new SafeStop('SMTP_CREDENTIAL_MISSING', 'Enabled SMTP requires an existing app password Docker Secret');
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    await writeFile(smtpPasswordPath, 'disabled\n', { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  }
}
await chmod(smtpPasswordPath, 0o600);

const hmacPath = join(target, 'suppression_hmac_key');
try {
  const existing = (await readFile(hmacPath, 'utf8')).trim();
  if (Buffer.byteLength(existing) < 32) throw new Error('invalid');
} catch (error) {
  if (error?.code !== 'ENOENT' && error?.message !== 'invalid') throw error;
  await writeFile(hmacPath, `${randomBytes(48).toString('base64url')}\n`, { encoding: 'utf8', mode: 0o600, flag: error?.code === 'ENOENT' ? 'wx' : 'w' });
}
await chmod(hmacPath, 0o600);

console.log(JSON.stringify({ ok: true, target: '.secrets', runtime_secret_files: 9, plaintext_exposed: false }));

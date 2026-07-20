import { lstat, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnvText } from '../n8n/code/lib/gmail-config.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const envPath = join(root, '.env');
const secretPath = join(root, '.secrets', 'smtp_password');

let configured = false;
let enabled = false;
let secretReady = false;
let safeCode = 'GMAIL_SETUP_REQUIRED';
try {
  const [envInfo, secretInfo] = await Promise.all([lstat(envPath), lstat(secretPath)]);
  if (envInfo.isSymbolicLink() || secretInfo.isSymbolicLink()) throw new Error('link');
  const [envText, secretText] = await Promise.all([readFile(envPath, 'utf8'), readFile(secretPath, 'utf8')]);
  const env = parseEnvText(envText);
  const sender = String(env.get('SMTP_USER') ?? '').trim().toLowerCase();
  configured = env.get('SMTP_HOST') === 'smtp.gmail.com'
    && env.get('SMTP_PORT') === '465'
    && /^[^\s@]+@gmail\.com$/u.test(sender)
    && String(env.get('MAIL_FROM_ADDRESS') ?? '').trim().toLowerCase() === sender;
  enabled = env.get('MAIL_TRANSPORT') === 'smtp'
    && env.get('LIVE_SEND_ENABLED') === 'true'
    && Number(env.get('DAILY_SEND_LIMIT')) >= 1
    && Number(env.get('DAILY_SEND_LIMIT')) <= 30;
  const secret = secretText.trim();
  secretReady = secret !== 'disabled' && /^[A-Za-z0-9]{16}$/u.test(secret);
  safeCode = configured && enabled && secretReady
    ? 'READY_FOR_SMTP_RUNTIME'
    : (configured && secretReady ? 'GMAIL_SELF_TEST_REQUIRED' : 'GMAIL_SETUP_REQUIRED');
} catch (error) {
  safeCode = error?.message === 'link' ? 'SECRET_PATH_BLOCKED' : 'GMAIL_SETUP_REQUIRED';
}

console.log(JSON.stringify({ ok: safeCode === 'READY_FOR_SMTP_RUNTIME', configured, enabled, secret_ready: secretReady, network_checked: false, email_sent: false, safe_code: safeCode }, null, 2));
if (safeCode !== 'READY_FOR_SMTP_RUNTIME') process.exitCode = 1;

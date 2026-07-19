import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { asSafeResult, SafeStop } from '../n8n/code/lib/errors.mjs';
import { configureGmailEnv, normalizeGoogleAppPassword } from '../n8n/code/lib/gmail-config.mjs';
import { createSmtpMailerFromEnv } from '../n8n/code/lib/smtp-mailer.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const envPath = join(root, '.env');
const secretPath = join(root, '.secrets', 'smtp_password');
const evidencePath = join(root, 'artifacts', 'evidence', 'gmail-self-test.json');
let mailer;

try {
  if (process.env.MAIL_TRANSPORT !== 'disabled' || process.env.LIVE_SEND_ENABLED !== 'false' || process.env.DAILY_SEND_LIMIT !== '0') {
    throw new SafeStop('GMAIL_SELF_TEST_STATE_INVALID', 'Owner-address self-test is allowed only while campaign delivery is disabled');
  }
  if (process.env.SMTP_HOST !== 'smtp.gmail.com' || process.env.SMTP_PORT !== '465') throw new SafeStop('GMAIL_SETUP_REQUIRED', 'Gmail SMTP endpoint is not staged');
  const sender = String(process.env.SMTP_USER ?? '').trim().toLowerCase();
  const fromAddress = String(process.env.MAIL_FROM_ADDRESS ?? '').trim().toLowerCase();
  if (!/^[^\s@]+@gmail\.com$/u.test(sender) || sender !== fromAddress) throw new SafeStop('GMAIL_SENDER_INVALID', 'Self-test recipient must equal the configured Gmail sender');
  const [envInfo, secretInfo] = await Promise.all([lstat(envPath), lstat(secretPath)]);
  if (envInfo.isSymbolicLink() || secretInfo.isSymbolicLink()) throw new SafeStop('SECRET_PATH_BLOCKED', 'SMTP configuration and secret must not be symlinks');
  const [envText, secretText] = await Promise.all([readFile(envPath, 'utf8'), readFile(secretPath, 'utf8')]);
  if (secretText.trim() === 'disabled') throw new SafeStop('GMAIL_SETUP_REQUIRED', 'Run gmail:setup before the owner-address self-test');
  const password = normalizeGoogleAppPassword(secretText);
  mailer = createSmtpMailerFromEnv({ ...process.env, SMTP_PASSWORD: password });
  await mailer.verify();
  await mailer.sendDraft({
    recipient_email: sender,
    subject: 'Workoutreach — проверка Gmail SMTP',
    body_text: 'Это диагностическое письмо отправлено только владельцу. Проверьте отправителя, plain-text, HTML и PDF-вложение. Оно не относится к outreach-кампании.',
    body_html: '<p>Это диагностическое письмо отправлено только владельцу.</p><p>Проверьте отправителя, plain-text, HTML и PDF-вложение. Оно не относится к outreach-кампании.</p>',
    attachment_sha256: process.env.CV_ATTACHMENT_SHA256,
  });
  await writeFile(envPath, configureGmailEnv(envText), { encoding: 'utf8', mode: 0o600 });
  const evidence = { ok: true, kind: 'owner_address_smtp_self_test', provider_accepted: true, recipient_is_sender: true, attachment_validated: true, campaign_message: false, openai_calls: 0, completed_at: new Date().toISOString() };
  await mkdir(dirname(evidencePath), { recursive: true });
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ ...evidence, evidence: 'artifacts/evidence/gmail-self-test.json' }));
} catch (error) {
  console.error(JSON.stringify(asSafeResult(error)));
  process.exitCode = 1;
} finally {
  mailer?.close();
}

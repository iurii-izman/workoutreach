import { chmod, lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SafeStop } from '../n8n/code/lib/errors.mjs';
import { configureGmailEnv, disableGmailEnv, normalizeGoogleAppPassword, parseEnvText } from '../n8n/code/lib/gmail-config.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const envPath = join(root, '.env');
const secretDirectory = join(root, '.secrets');
const secretPath = join(secretDirectory, 'smtp_password');
const disabling = process.argv.includes('--disable');

async function rejectLink(path, allowMissing = false) {
  try {
    const info = await lstat(path);
    if (info.isSymbolicLink()) throw new SafeStop('SECRET_PATH_BLOCKED', 'Secret destination must not be a symlink');
  } catch (error) {
    if (allowMissing && error?.code === 'ENOENT') return;
    throw error;
  }
}

await rejectLink(envPath);
await mkdir(secretDirectory, { recursive: true });
await rejectLink(secretDirectory);
await rejectLink(secretPath, true);
let envText = await readFile(envPath, 'utf8');

if (disabling) {
  envText = disableGmailEnv(envText);
  await writeFile(envPath, envText, { encoding: 'utf8', mode: 0o600 });
  console.log(JSON.stringify({ ok: true, gmail: 'disabled', password_removed: false, secret_exposed: false }));
  process.exit(0);
}

let input = '';
process.stdin.setEncoding('utf8');
for await (const chunk of process.stdin) input += chunk;
const appPassword = normalizeGoogleAppPassword(input);

await writeFile(secretPath, `${appPassword}\n`, { encoding: 'utf8', mode: 0o600 });
await chmod(secretPath, 0o600);
// Credential provisioning is not transmission authorization. Keep all mail
// kill switches enabled until the explicit owner-address self-test succeeds.
envText = disableGmailEnv(configureGmailEnv(envText));
await writeFile(envPath, envText, { encoding: 'utf8', mode: 0o600 });
const senderConfigured = Boolean(parseEnvText(envText).get('SMTP_USER'));
console.log(JSON.stringify({ ok: true, gmail: 'credential_configured', sender_configured: senderConfigured, live_send_enabled: false, next: 'npm run gmail:self-test', password_location: '.secrets/smtp_password', secret_exposed: false }));

import { SafeStop } from './errors.mjs';

export function parseEnvText(text) {
  const values = new Map();
  for (const line of String(text).split(/\r?\n/u)) {
    const match = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/u);
    if (match) values.set(match[1], match[2]);
  }
  return values;
}

export function upsertEnvValue(text, name, value) {
  const line = `${name}=${value}`;
  const pattern = new RegExp(`^${name}=.*$`, 'mu');
  return pattern.test(text) ? text.replace(pattern, line) : `${text.trimEnd()}\n${line}\n`;
}

export function normalizeGoogleAppPassword(input) {
  const normalized = String(input).replace(/\s+/gu, '');
  if (!/^[A-Za-z0-9]{16}$/u.test(normalized)) {
    throw new SafeStop('GMAIL_APP_PASSWORD_INVALID', 'Google app password must contain exactly 16 letters or digits');
  }
  return normalized;
}

export function configureGmailEnv(text) {
  const current = parseEnvText(text);
  const sender = String(current.get('SMTP_USER') ?? '').trim().toLowerCase();
  const fromAddress = String(current.get('MAIL_FROM_ADDRESS') ?? sender).trim().toLowerCase();
  if (!/^[^\s@]+@gmail\.com$/u.test(sender) || sender !== fromAddress) {
    throw new SafeStop('GMAIL_SENDER_INVALID', 'SMTP_USER and MAIL_FROM_ADDRESS must be the same configured Gmail address');
  }

  let result = String(text).replace(/^SMTP_PASSWORD=.*(?:\r?\n|$)/gmu, '');
  for (const [name, value] of Object.entries({
    MAIL_TRANSPORT: 'smtp',
    LIVE_SEND_ENABLED: 'true',
    SMTP_HOST: 'smtp.gmail.com',
    SMTP_PORT: '465',
    SMTP_USER: sender,
    MAIL_FROM_ADDRESS: sender,
    DAILY_SEND_LIMIT: '30',
  })) result = upsertEnvValue(result, name, value);
  return result;
}

export function disableGmailEnv(text) {
  let result = String(text).replace(/^SMTP_PASSWORD=.*(?:\r?\n|$)/gmu, '');
  result = upsertEnvValue(result, 'MAIL_TRANSPORT', 'disabled');
  result = upsertEnvValue(result, 'LIVE_SEND_ENABLED', 'false');
  result = upsertEnvValue(result, 'DAILY_SEND_LIMIT', '0');
  return result;
}

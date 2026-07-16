import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateConfiguredCv } from '../n8n/code/lib/attachments.mjs';
import { asSafeResult, SafeStop } from '../n8n/code/lib/errors.mjs';
import { parseIdAllowlist } from '../n8n/code/lib/telegram-api.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const writeSingleAllowlist = process.argv.includes('--write-single-telegram-allowlist');

function requireFormat(value, pattern, code, message) {
  if (typeof value !== 'string' || !pattern.test(value)) throw new SafeStop(code, message);
  return value;
}

async function openAiCheck(apiKey) {
  let response;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  timer.unref?.();
  try {
    response = await fetch('https://api.openai.com/v1/models', {
      headers: { authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
    });
  } catch {
    throw new SafeStop('OPENAI_NETWORK_ERROR', 'OpenAI credential check could not reach the API');
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) throw new SafeStop('OPENAI_CREDENTIAL_REJECTED', 'OpenAI credential check was rejected', { status: response.status });
  return { authenticated: true, check: 'GET /v1/models', billed_model_call: false };
}

async function telegramCall(token, method, payload = {}) {
  let response;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  timer.unref?.();
  try {
    response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } catch {
    throw new SafeStop('TELEGRAM_NETWORK_ERROR', 'Telegram credential check could not reach the API');
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) throw new SafeStop('TELEGRAM_CREDENTIAL_REJECTED', 'Telegram credential check was rejected', { status: response.status });
  const body = await response.json().catch(() => null);
  if (!body?.ok) throw new SafeStop('TELEGRAM_CREDENTIAL_REJECTED', 'Telegram credential check was rejected', { error_code: body?.error_code ?? null });
  return body.result;
}

function configuredAllowlist(value) {
  if (!value || value.startsWith('REPLACE_')) return new Set();
  return parseIdAllowlist(value);
}

async function updateIgnoredEnv(userId, chatId) {
  const path = join(root, '.env');
  let contents = await readFile(path, 'utf8');
  const upsert = (key, value) => {
    const pattern = new RegExp(`^${key}=.*$`, 'mu');
    contents = pattern.test(contents) ? contents.replace(pattern, `${key}=${value}`) : `${contents.trimEnd()}\n${key}=${value}\n`;
  };
  upsert('ALLOWED_TELEGRAM_USER_IDS', userId);
  upsert('ALLOWED_TELEGRAM_CHAT_IDS', chatId);
  await writeFile(path, contents.replace(/^\uFEFF/u, '').replace(/\r\n/gu, '\n'), { encoding: 'utf8', mode: 0o600 });
}

try {
  const openAiKey = requireFormat(process.env.OPENAI_API_KEY, /^sk-[A-Za-z0-9_-]{32,}$/u, 'OPENAI_CREDENTIAL_FORMAT', 'OPENAI_API_KEY has an invalid format');
  const telegramToken = requireFormat(process.env.TELEGRAM_BOT_TOKEN, /^\d+:[A-Za-z0-9_-]{20,}$/u, 'TELEGRAM_CREDENTIAL_FORMAT', 'TELEGRAM_BOT_TOKEN has an invalid format');
  const [openai, bot, webhook, cv] = await Promise.all([
    openAiCheck(openAiKey),
    telegramCall(telegramToken, 'getMe'),
    telegramCall(telegramToken, 'getWebhookInfo'),
    validateConfiguredCv(),
  ]);

  let candidates = [];
  if (!webhook.url) {
    const updates = await telegramCall(telegramToken, 'getUpdates', { limit: 100, allowed_updates: ['message'] });
    const unique = new Map();
    for (const update of updates) {
      const message = update.message;
      if (message?.chat?.type !== 'private' || message?.from?.id == null || message?.chat?.id == null) continue;
      unique.set(`${message.from.id}:${message.chat.id}`, { userId: String(message.from.id), chatId: String(message.chat.id) });
    }
    candidates = [...unique.values()];
  }

  let allowlistUpdated = false;
  if (writeSingleAllowlist && candidates.length === 1) {
    await updateIgnoredEnv(candidates[0].userId, candidates[0].chatId);
    allowlistUpdated = true;
  }
  const userAllowlist = allowlistUpdated ? new Set([candidates[0].userId]) : configuredAllowlist(process.env.ALLOWED_TELEGRAM_USER_IDS);
  const chatAllowlist = allowlistUpdated ? new Set([candidates[0].chatId]) : configuredAllowlist(process.env.ALLOWED_TELEGRAM_CHAT_IDS);

  console.log(JSON.stringify({
    ok: true,
    openai,
    telegram: {
      authenticated: true,
      bot_username: bot.username ?? null,
      webhook_configured: Boolean(webhook.url),
      private_update_candidates: webhook.url ? null : candidates.length,
      allowlist_configured: userAllowlist.size > 0 && chatAllowlist.size > 0,
      allowlist_updated: allowlistUpdated,
    },
    cv: { validated: true, filename: cv.filename, bytes: cv.bytes, sha256_matches: true },
    mail: { transport: 'disabled', live_send_enabled: false },
  }, null, 2));
} catch (error) {
  console.error(JSON.stringify(asSafeResult(error), null, 2));
  process.exit(1);
}

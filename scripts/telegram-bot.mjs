import { mkdir, open, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { asSafeResult, SafeStop } from '../n8n/code/lib/errors.mjs';
import { analyzeLiveCompany } from '../n8n/code/lib/live-analysis.mjs';
import { createTelegramClient, parseIdAllowlist } from '../n8n/code/lib/telegram-api.mjs';
import { createTelegramBotHandler } from '../n8n/code/lib/telegram-bot.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const runtime = join(root, '.runtime');
const lockPath = join(runtime, 'telegram-bot.lock');
const statePath = join(runtime, 'telegram-bot-state.json');
const statusPath = join(runtime, 'telegram-bot-status.json');
const startedAt = new Date().toISOString();
let stopping = false;
let lockOwned = false;

function processAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}

async function acquireLock() {
  await mkdir(runtime, { recursive: true });
  try {
    const handle = await open(lockPath, 'wx', 0o600);
    await handle.writeFile(`${process.pid}\n`, 'utf8');
    await handle.close();
    lockOwned = true;
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
    const existingPid = Number((await readFile(lockPath, 'utf8').catch(() => '')).trim());
    if (processAlive(existingPid)) throw new SafeStop('BOT_ALREADY_RUNNING', 'Telegram bot polling process is already running');
    await rm(lockPath, { force: true });
    return acquireLock();
  }
}

async function readOffset() {
  try {
    const state = JSON.parse(await readFile(statePath, 'utf8'));
    return Number.isSafeInteger(state.offset) ? state.offset : undefined;
  } catch {
    return undefined;
  }
}

async function writeState(offset) {
  await writeFile(statePath, `${JSON.stringify({ offset, updated_at: new Date().toISOString() }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
}

async function writeStatus(status, extra = {}) {
  await writeFile(statusPath, `${JSON.stringify({
    status,
    pid: process.pid,
    started_at: startedAt,
    heartbeat_at: new Date().toISOString(),
    mode: 'allowlisted-long-polling',
    mail_transport: 'disabled',
    ...extra,
  }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
}

function requestStop() { stopping = true; }
process.on('SIGINT', requestStop);
process.on('SIGTERM', requestStop);

async function main() {
  if ((process.env.TELEGRAM_MODE ?? 'stub') !== 'live-preview') throw new SafeStop('TELEGRAM_MODE_BLOCKED', 'TELEGRAM_MODE must be live-preview');
  if ((process.env.OPENAI_MODE ?? 'stub') !== 'live-eval') throw new SafeStop('OPENAI_MODE_BLOCKED', 'OPENAI_MODE must be live-eval');
  if ((process.env.MAIL_TRANSPORT ?? 'disabled') !== 'disabled' || process.env.LIVE_SEND_ENABLED?.toLowerCase() === 'true') {
    throw new SafeStop('LIVE_SEND_BLOCKED', 'Telegram bot requires mail transmission to remain disabled');
  }
  await acquireLock();
  const allowlist = {
    userIds: parseIdAllowlist(process.env.ALLOWED_TELEGRAM_USER_IDS),
    chatIds: parseIdAllowlist(process.env.ALLOWED_TELEGRAM_CHAT_IDS),
  };
  if (allowlist.userIds.size === 0 || allowlist.chatIds.size === 0) throw new SafeStop('TELEGRAM_ALLOWLIST_EMPTY', 'Telegram user and chat allowlists are required');
  const client = createTelegramClient({ botToken: process.env.TELEGRAM_BOT_TOKEN, allowedChatIds: allowlist.chatIds });
  const webhook = await client.call('getWebhookInfo');
  if (webhook.url) throw new SafeStop('TELEGRAM_WEBHOOK_CONFLICT', 'Long polling cannot start while a webhook is configured');

  const maxRegenerations = Number(process.env.MAX_REGENERATIONS ?? 2);
  const pollTimeoutSeconds = Number(process.env.TELEGRAM_POLL_TIMEOUT_SECONDS ?? 25);
  if (!Number.isSafeInteger(maxRegenerations) || maxRegenerations < 0 || maxRegenerations > 5) throw new SafeStop('BOT_CONFIG_INVALID', 'MAX_REGENERATIONS must be an integer from 0 to 5');
  if (!Number.isSafeInteger(pollTimeoutSeconds) || pollTimeoutSeconds < 1 || pollTimeoutSeconds > 50) throw new SafeStop('BOT_CONFIG_INVALID', 'TELEGRAM_POLL_TIMEOUT_SECONDS must be an integer from 1 to 50');
  const handler = createTelegramBotHandler({
    client,
    allowlist,
    maxRegenerations,
    analyze: ({ inputUrl, seed }) => analyzeLiveCompany({ root, inputUrl, seed }),
  });
  let offset = await readOffset();
  await writeStatus('running', { offset_configured: Number.isSafeInteger(offset) });
  console.log(JSON.stringify({ event: 'telegram_bot_started', ok: true, mail_transport: 'disabled' }));

  while (!stopping) {
    let updates;
    try {
      updates = await client.getUpdates(offset, pollTimeoutSeconds);
    } catch (error) {
      const safe = asSafeResult(error);
      await writeStatus('degraded', { safe_error_code: safe.code });
      console.error(JSON.stringify({ event: 'telegram_poll_retry', code: safe.code }));
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 2_000));
      continue;
    }
    for (const update of updates) {
      try {
        const result = await handler.handleUpdate(update);
        console.log(JSON.stringify({ event: 'telegram_update_processed', ok: result.ok, action: result.action ?? null, ignored: result.ignored ?? false }));
      } catch (error) {
        console.error(JSON.stringify({ event: 'telegram_update_failed', code: asSafeResult(error).code }));
      }
      offset = update.update_id + 1;
      await writeState(offset);
    }
    await writeStatus('running', { offset_configured: Number.isSafeInteger(offset) });
  }
}

try {
  await main();
  await writeStatus('stopped');
} catch (error) {
  const safe = asSafeResult(error);
  await mkdir(runtime, { recursive: true });
  await writeStatus('failed', { safe_error_code: safe.code });
  console.error(JSON.stringify(safe));
  process.exitCode = 1;
} finally {
  if (lockOwned) await rm(lockPath, { force: true });
}

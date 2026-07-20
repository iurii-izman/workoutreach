import { mkdir, open, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { asSafeResult, SafeStop } from '../n8n/code/lib/errors.mjs';
import { analyzeLiveCompany } from '../n8n/code/lib/live-analysis.mjs';
import { createTelegramClient, parseIdAllowlist } from '../n8n/code/lib/telegram-api.mjs';
import { createTelegramBotHandler } from '../n8n/code/lib/telegram-bot.mjs';
import { createPostgresPoolFromEnv, PostgresBotStore } from '../n8n/code/lib/postgres-store.mjs';
import { createSmtpMailerFromEnv } from '../n8n/code/lib/smtp-mailer.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const runtime = join(root, '.runtime');
const lockPath = join(runtime, 'telegram-bot.lock');
const statePath = join(runtime, 'telegram-bot-state.json');
const statusPath = join(runtime, 'telegram-bot-status.json');
const startedAt = new Date().toISOString();
let stopping = false;
let lockOwned = false;
let stateStore = null;
let smtpMailer = null;

function processAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}

async function processStartTicks(pid) {
  try {
    const stat = await readFile(`/proc/${pid}/stat`, 'utf8');
    const fieldsAfterCommand = stat.slice(stat.lastIndexOf(')') + 2).trim().split(/\s+/u);
    return fieldsAfterCommand[19] ?? null;
  } catch {
    return null;
  }
}

async function lockMatchesRunningProcess(value) {
  const legacyPid = Number(String(value).trim());
  if (Number.isSafeInteger(legacyPid)) {
    // Docker guarantees one PID-1 bot per container. A numeric PID-1 lock from
    // an older container lifecycle is stale because PID 1 is reused on restart.
    if (process.env.BOT_STATE_MODE === 'postgres' && legacyPid === 1) return false;
    return processAlive(legacyPid);
  }
  try {
    const lock = JSON.parse(value);
    if (!processAlive(lock.pid)) return false;
    const currentTicks = await processStartTicks(lock.pid);
    return currentTicks === null || lock.start_ticks === currentTicks;
  } catch {
    return false;
  }
}

async function acquireLock() {
  await mkdir(runtime, { recursive: true });
  try {
    const handle = await open(lockPath, 'wx', 0o600);
    await handle.writeFile(`${JSON.stringify({ pid: process.pid, start_ticks: await processStartTicks(process.pid) })}\n`, 'utf8');
    await handle.close();
    lockOwned = true;
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
    const existingLock = await readFile(lockPath, 'utf8').catch(() => '');
    if (await lockMatchesRunningProcess(existingLock)) throw new SafeStop('BOT_ALREADY_RUNNING', 'Telegram bot polling process is already running');
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
    mode: process.env.BOT_STATE_MODE === 'postgres' ? 'local-postgres-long-polling' : 'allowlisted-long-polling',
    mail_transport: process.env.MAIL_TRANSPORT ?? 'disabled',
    ...extra,
  }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
}

function requestStop() { stopping = true; }
process.on('SIGINT', requestStop);
process.on('SIGTERM', requestStop);

async function main() {
  if ((process.env.TELEGRAM_MODE ?? 'stub') !== 'live-preview') throw new SafeStop('TELEGRAM_MODE_BLOCKED', 'TELEGRAM_MODE must be live-preview');
  if ((process.env.OPENAI_MODE ?? 'stub') !== 'live-eval') throw new SafeStop('OPENAI_MODE_BLOCKED', 'OPENAI_MODE must be live-eval');
  const liveSendEnabled = process.env.LIVE_SEND_ENABLED?.toLowerCase() === 'true';
  const mailTransport = process.env.MAIL_TRANSPORT ?? 'disabled';
  if ((liveSendEnabled && mailTransport !== 'smtp') || (!liveSendEnabled && mailTransport !== 'disabled')) throw new SafeStop('MAIL_CONFIG_INVALID', 'Mail runtime must be either disabled or explicitly enabled with SMTP');
  await acquireLock();
  const allowlist = {
    userIds: parseIdAllowlist(process.env.ALLOWED_TELEGRAM_USER_IDS),
    chatIds: parseIdAllowlist(process.env.ALLOWED_TELEGRAM_CHAT_IDS),
  };
  if (allowlist.userIds.size === 0 || allowlist.chatIds.size === 0) throw new SafeStop('TELEGRAM_ALLOWLIST_EMPTY', 'Telegram user and chat allowlists are required');
  if ((process.env.BOT_STATE_MODE ?? 'memory') === 'postgres') {
    stateStore = new PostgresBotStore({
      pool: createPostgresPoolFromEnv(process.env),
      suppressionHmacKey: process.env.SUPPRESSION_HMAC_KEY,
      modelId: process.env.OPENAI_MODEL ?? 'gpt-5.6',
      mailEnabled: liveSendEnabled,
    });
    await stateStore.verifyReady();
    // Fail closed across container restarts: database delivery is disabled
    // before any external SMTP authentication attempt can fail or time out.
    await stateStore.syncMailRuntime({ enabled: false, dailyLimit: 0 });
    await stateStore.syncAllowlist(allowlist);
    const dailySendLimit = Number(process.env.DAILY_SEND_LIMIT ?? 0);
    if (liveSendEnabled) {
      if (!Number.isSafeInteger(dailySendLimit) || dailySendLimit < 1 || dailySendLimit > 5) throw new SafeStop('DAILY_SEND_LIMIT_INVALID', 'Live SMTP requires a daily send limit from 1 to 5');
      smtpMailer = createSmtpMailerFromEnv(process.env);
      await smtpMailer.verify();
      await stateStore.syncMailRuntime({ enabled: true, dailyLimit: dailySendLimit });
    }
  }
  const client = createTelegramClient({ botToken: process.env.TELEGRAM_BOT_TOKEN, allowedChatIds: allowlist.chatIds });
  const webhook = await client.call('getWebhookInfo');
  if (webhook.url) throw new SafeStop('TELEGRAM_WEBHOOK_CONFLICT', 'Long polling cannot start while a webhook is configured');

  const maxRegenerations = Number(process.env.MAX_REGENERATIONS ?? 2);
  const dailyAnalysisLimit = Number(process.env.DAILY_ANALYSIS_LIMIT ?? 2);
  const pollTimeoutSeconds = Number(process.env.TELEGRAM_POLL_TIMEOUT_SECONDS ?? 25);
  if (!Number.isSafeInteger(maxRegenerations) || maxRegenerations < 0 || maxRegenerations > 5) throw new SafeStop('BOT_CONFIG_INVALID', 'MAX_REGENERATIONS must be an integer from 0 to 5');
  if (!Number.isSafeInteger(dailyAnalysisLimit) || dailyAnalysisLimit < 1 || dailyAnalysisLimit > 20) throw new SafeStop('BOT_CONFIG_INVALID', 'DAILY_ANALYSIS_LIMIT must be an integer from 1 to 20');
  if (!Number.isSafeInteger(pollTimeoutSeconds) || pollTimeoutSeconds < 1 || pollTimeoutSeconds > 50) throw new SafeStop('BOT_CONFIG_INVALID', 'TELEGRAM_POLL_TIMEOUT_SECONDS must be an integer from 1 to 50');
  const handler = createTelegramBotHandler({
    client,
    allowlist,
    stateStore,
    maxRegenerations,
    dailyAnalysisLimit,
    analyze: ({ inputUrl, seed, jobId, beforeModelCalls }) => analyzeLiveCompany({ root, inputUrl, seed, jobId, beforeModelCalls }),
  });
  let offset = await readOffset();
  await writeStatus('running', { offset_configured: Number.isSafeInteger(offset) });
  console.log(JSON.stringify({ event: 'telegram_bot_started', ok: true, mail_transport: mailTransport }));

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
    if (smtpMailer && stateStore) {
      const workerId = 'local-smtp-worker';
      const queued = await stateStore.claimNextSmtp(workerId);
      if (queued) {
        try {
          const delivery = await smtpMailer.sendDraft(queued);
          if (!await stateStore.completeSmtp(queued.outbox_id, workerId, delivery.messageId)) throw new SafeStop('SMTP_STATE_LOST', 'SMTP acceptance could not be persisted');
          await client.sendText(String(queued.telegram_chat_id), `#${queued.job_id}\nSMTP-провайдер принял письмо. Это не подтверждает доставку во входящие.`).catch(() => {});
        } catch (error) {
          const safe = asSafeResult(error);
          await stateStore.failSmtp(queued.outbox_id, workerId, safe.code).catch(() => {});
          await client.sendText(String(queued.telegram_chat_id), `#${queued.job_id}\nОтправка безопасно остановлена. Код: ${safe.code}. Автоматического повтора нет, чтобы исключить дубль.`).catch(() => {});
        }
      }
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
  if (stateStore) await stateStore.close().catch(() => {});
  smtpMailer?.close();
  if (lockOwned) await rm(lockPath, { force: true });
}

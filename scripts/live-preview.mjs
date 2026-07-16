import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateConfiguredCv } from '../n8n/code/lib/attachments.mjs';
import { asSafeResult, SafeStop } from '../n8n/code/lib/errors.mjs';
import { createOpenAIAdapter } from '../n8n/code/lib/openai.mjs';
import { analyzeDryRun, loadOfferProfile } from '../n8n/code/lib/pipeline.mjs';
import { safeFetch } from '../n8n/code/lib/safe-fetch.mjs';
import { createTelegramClient, parseIdAllowlist } from '../n8n/code/lib/telegram-api.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sendTelegram = process.argv.includes('--telegram');
const chatArg = process.argv.find((value) => value.startsWith('--chat='))?.slice('--chat='.length);
const positional = process.argv.slice(2).filter((value) => !value.startsWith('--'));

try {
  if (positional.length !== 1) throw new SafeStop('LIVE_URL_REQUIRED', 'Pass exactly one public company URL');
  if (process.env.LIVE_SEND_ENABLED?.toLowerCase() === 'true' || (process.env.MAIL_TRANSPORT ?? 'disabled') !== 'disabled') {
    throw new SafeStop('LIVE_SEND_BLOCKED', 'Mail must remain disabled for a live preview');
  }
  if ((process.env.OPENAI_MODE ?? 'stub') !== 'live-eval') throw new SafeStop('OPENAI_MODE_BLOCKED', 'Set OPENAI_MODE=live-eval explicitly for a live preview');

  const offerProfile = await loadOfferProfile(root);
  const attachment = await validateConfiguredCv();
  const modelAdapter = createOpenAIAdapter({ apiKey: process.env.OPENAI_API_KEY });
  await mkdir(join(root, 'artifacts/evidence'), { recursive: true });
  const result = await analyzeDryRun({
    root,
    inputUrl: positional[0],
    fetcher: (url) => safeFetch(url, {
      maxRedirects: Number(process.env.MAX_REDIRECTS ?? 3),
      timeoutMs: Number(process.env.PAGE_TIMEOUT_MS ?? 10_000),
      maxBytes: Number(process.env.MAX_RESPONSE_BYTES ?? 2_097_152),
    }),
    modelAdapter,
    offerProfile,
    attachment,
    modelSettings: {
      model: process.env.OPENAI_MODEL ?? 'gpt-5.6',
      effort: process.env.OPENAI_REASONING_EFFORT ?? 'low',
      maxOutputTokens: Number(process.env.OPENAI_MAX_OUTPUT_TOKENS ?? 2200),
    },
    onModelEnvelope: ({ phase, envelope }) => writeFile(
      join(root, 'artifacts/evidence', `live-model-${phase}.json`),
      `${JSON.stringify(envelope, null, 2)}\n`,
      'utf8',
    ),
    mode: 'guarded-live-eval',
  });

  let telegram = { requested: false, transmitted: false };
  if (sendTelegram) {
    if ((process.env.TELEGRAM_MODE ?? 'stub') !== 'live-preview') throw new SafeStop('TELEGRAM_MODE_BLOCKED', 'Set TELEGRAM_MODE=live-preview explicitly before transmitting a preview');
    const allowedChatIds = parseIdAllowlist(process.env.ALLOWED_TELEGRAM_CHAT_IDS);
    const chatId = chatArg ?? (allowedChatIds.size === 1 ? [...allowedChatIds][0] : null);
    if (!chatId) throw new SafeStop('TELEGRAM_CHAT_REQUIRED', 'Select one allowlisted chat with --chat=ID');
    const client = createTelegramClient({ botToken: process.env.TELEGRAM_BOT_TOKEN, allowedChatIds });
    telegram = { requested: true, ...(await client.sendPreview(result.telegram_preview, chatId)) };
    result.safety.telegram_preview_transmitted = true;
  }

  await writeFile(join(root, 'artifacts/evidence/live-preview.json'), `${JSON.stringify({ ...result, telegram }, null, 2)}\n`, 'utf8');
  console.log(result.telegram_preview.text);
  console.log('\nLIVE EVAL SAFETY');
  console.log(JSON.stringify({ job_id: result.job_id, model: result.evidence.fact_model?.model ?? null, telegram, mail_transmitted: false, outbox_created: false }, null, 2));
} catch (error) {
  console.error(JSON.stringify(asSafeResult(error), null, 2));
  process.exit(1);
}

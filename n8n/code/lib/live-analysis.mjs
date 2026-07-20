import { validateConfiguredCv } from './attachments.mjs';
import { SafeStop } from './errors.mjs';
import { createOpenAIAdapter } from './openai.mjs';
import { analyzeDryRun, loadOfferProfile } from './pipeline.mjs';
import { safeFetch } from './safe-fetch.mjs';

function positiveNumber(value, fallback, name) {
  const parsed = Number(value ?? fallback);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new SafeStop('LIVE_CONFIG_INVALID', `${name} must be a positive number`);
  return parsed;
}

export function assertLiveAnalysisRuntime(env = process.env) {
  const liveSendEnabled = String(env.LIVE_SEND_ENABLED ?? 'false').toLowerCase() === 'true';
  const mailTransport = env.MAIL_TRANSPORT ?? 'disabled';
  const dailySendLimit = Number(env.DAILY_SEND_LIMIT ?? 0);
  const disabledRuntime = !liveSendEnabled && mailTransport === 'disabled' && dailySendLimit === 0;
  const guardedSmtpRuntime = liveSendEnabled
    && mailTransport === 'smtp'
    && Number.isSafeInteger(dailySendLimit)
    && dailySendLimit >= 1
    && dailySendLimit <= 5;
  if (!disabledRuntime && !guardedSmtpRuntime) {
    throw new SafeStop('MAIL_CONFIG_INVALID', 'Live analysis requires either the disabled mail state or the guarded SMTP state');
  }
  return Object.freeze({ liveSendEnabled, mailTransport, dailySendLimit });
}

export async function analyzeLiveCompany({ root, inputUrl, env = process.env, seed = inputUrl, jobId = undefined, onModelEnvelope = null, modelAdapter = null } = {}) {
  assertLiveAnalysisRuntime(env);
  if ((env.OPENAI_MODE ?? 'stub') !== 'live-eval') throw new SafeStop('OPENAI_MODE_BLOCKED', 'OPENAI_MODE must be live-eval');

  const offerProfile = await loadOfferProfile(root);
  const attachment = await validateConfiguredCv(env);
  return analyzeDryRun({
    root,
    inputUrl,
    seed,
    jobId,
    fetcher: (url) => safeFetch(url, {
      maxRedirects: positiveNumber(env.MAX_REDIRECTS, 3, 'MAX_REDIRECTS'),
      timeoutMs: positiveNumber(env.PAGE_TIMEOUT_MS, 10_000, 'PAGE_TIMEOUT_MS'),
      maxBytes: positiveNumber(env.MAX_RESPONSE_BYTES, 2_097_152, 'MAX_RESPONSE_BYTES'),
    }),
    modelAdapter: modelAdapter ?? createOpenAIAdapter({ apiKey: env.OPENAI_API_KEY }),
    offerProfile,
    attachment,
    crawlLimits: {
      maxPages: positiveNumber(env.MAX_PAGES, 6, 'MAX_PAGES'),
      maxTextChars: positiveNumber(env.MAX_CLEAN_TEXT_CHARS, 120_000, 'MAX_CLEAN_TEXT_CHARS'),
      jobTimeoutMs: positiveNumber(env.JOB_TIMEOUT_MS, 60_000, 'JOB_TIMEOUT_MS'),
    },
    modelSettings: {
      model: env.OPENAI_MODEL ?? 'gpt-5.6',
      effort: env.OPENAI_REASONING_EFFORT ?? 'low',
      maxOutputTokens: positiveNumber(env.OPENAI_MAX_OUTPUT_TOKENS, 2200, 'OPENAI_MAX_OUTPUT_TOKENS'),
    },
    onModelEnvelope,
    mode: 'guarded-live-eval',
  });
}

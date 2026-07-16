import { SafeStop } from './errors.mjs';

const TELEGRAM_TEXT_LIMIT = 4096;
const SAFE_CHUNK_LIMIT = 3900;

export function parseIdAllowlist(value) {
  const ids = String(value ?? '').split(',').map((item) => item.trim()).filter(Boolean);
  if (ids.some((id) => !/^-?\d+$/u.test(id))) throw new SafeStop('TELEGRAM_ALLOWLIST_INVALID', 'Telegram allowlist must contain comma-separated numeric IDs');
  return new Set(ids);
}

export function splitTelegramText(text, limit = SAFE_CHUNK_LIMIT) {
  if (limit <= 0 || limit > TELEGRAM_TEXT_LIMIT) throw new RangeError('Telegram chunk limit is invalid');
  const chunks = [];
  let remaining = String(text);
  while (remaining.length > limit) {
    let cut = remaining.lastIndexOf('\n\n', limit);
    if (cut < Math.floor(limit / 2)) cut = remaining.lastIndexOf('\n', limit);
    if (cut < Math.floor(limit / 2)) cut = remaining.lastIndexOf(' ', limit);
    if (cut < 1) cut = limit;
    if (/^[\uDC00-\uDFFF]$/u.test(remaining[cut])) cut -= 1;
    chunks.push(remaining.slice(0, cut).trim());
    remaining = remaining.slice(cut).trimStart();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

export function createTelegramClient({ botToken, allowedChatIds, fetchImpl = globalThis.fetch, apiBase = 'https://api.telegram.org' } = {}) {
  if (typeof botToken !== 'string' || !/^\d+:[A-Za-z0-9_-]{20,}$/u.test(botToken)) {
    throw new SafeStop('TELEGRAM_CREDENTIAL_MISSING', 'A valid Telegram bot token is required');
  }
  const allowlist = allowedChatIds instanceof Set ? allowedChatIds : parseIdAllowlist(allowedChatIds);
  if (allowlist.size === 0) throw new SafeStop('TELEGRAM_ALLOWLIST_EMPTY', 'At least one Telegram chat ID must be allowlisted');

  function assertAllowedChat(chatId) {
    const normalizedChatId = String(chatId);
    if (!allowlist.has(normalizedChatId)) throw new SafeStop('TELEGRAM_UNAUTHORIZED', 'Telegram chat is not allowlisted');
    return normalizedChatId;
  }

  async function call(method, payload = {}, { timeoutMs = 15_000 } = {}) {
    let response;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    timer.unref?.();
    try {
      response = await fetchImpl(`${apiBase}/bot${botToken}/${method}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } catch {
      throw new SafeStop('TELEGRAM_NETWORK_ERROR', 'Telegram request failed before a safe response was received');
    } finally {
      clearTimeout(timer);
    }
    if (!response.ok) throw new SafeStop('TELEGRAM_HTTP_ERROR', 'Telegram returned a non-success HTTP status', { status: response.status });
    let body;
    try {
      body = await response.json();
    } catch {
      throw new SafeStop('TELEGRAM_RESPONSE_INVALID', 'Telegram returned an unreadable response');
    }
    if (!body.ok) throw new SafeStop('TELEGRAM_API_ERROR', 'Telegram rejected the Bot API request', { error_code: body.error_code ?? null });
    return body.result;
  }

  async function sendPreview(preview, chatId) {
    const normalizedChatId = assertAllowedChat(chatId);
    const chunks = splitTelegramText(preview.text);
    const messages = [];
    for (let index = 0; index < chunks.length; index += 1) {
      const final = index === chunks.length - 1;
      messages.push(await call('sendMessage', {
        chat_id: normalizedChatId,
        text: chunks[index],
        disable_web_page_preview: true,
        ...(final ? { reply_markup: preview.reply_markup } : {}),
      }));
    }
    return { transport: 'telegram-live-preview', transmitted: true, chunk_count: chunks.length, message_ids: messages.map((message) => message.message_id) };
  }

  async function sendText(chatId, text, options = {}) {
    const normalizedChatId = assertAllowedChat(chatId);
    const chunks = splitTelegramText(text);
    const messages = [];
    for (let index = 0; index < chunks.length; index += 1) {
      const final = index === chunks.length - 1;
      messages.push(await call('sendMessage', {
        chat_id: normalizedChatId,
        text: chunks[index],
        disable_web_page_preview: options.disableWebPagePreview ?? true,
        ...(final && options.replyMarkup ? { reply_markup: options.replyMarkup } : {}),
      }));
    }
    return messages;
  }

  async function getUpdates(offset, timeoutSeconds = 25) {
    return call('getUpdates', {
      ...(Number.isInteger(offset) ? { offset } : {}),
      limit: 20,
      timeout: timeoutSeconds,
      allowed_updates: ['message', 'callback_query'],
    }, { timeoutMs: (timeoutSeconds + 5) * 1000 });
  }

  async function answerCallbackQuery(callbackQueryId, options = {}) {
    return call('answerCallbackQuery', {
      callback_query_id: callbackQueryId,
      ...(options.text ? { text: options.text } : {}),
      show_alert: options.showAlert ?? false,
      cache_time: 0,
    });
  }

  async function sendChatAction(chatId, action = 'typing') {
    return call('sendChatAction', { chat_id: assertAllowedChat(chatId), action });
  }

  async function clearInlineKeyboard(chatId, messageId) {
    return call('editMessageReplyMarkup', {
      chat_id: assertAllowedChat(chatId),
      message_id: messageId,
      reply_markup: { inline_keyboard: [] },
    });
  }

  return { call, sendPreview, sendText, getUpdates, answerCallbackQuery, sendChatAction, clearInlineKeyboard };
}

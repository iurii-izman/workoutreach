import { SafeStop } from './errors.mjs';

export class MemoryDryRunStore {
  #updates = new Map();

  get(updateId) { return this.#updates.get(updateId); }
  put(updateId, result) { this.#updates.set(updateId, result); }
  get size() { return this.#updates.size; }
}

export function assertAllowed(update, allowlist) {
  const userId = String(update.message?.from?.id ?? update.callback_query?.from?.id ?? '');
  const chatId = String(update.message?.chat?.id ?? update.callback_query?.message?.chat?.id ?? '');
  if (!allowlist.userIds.has(userId) || !allowlist.chatIds.has(chatId)) {
    throw new SafeStop('TELEGRAM_UNAUTHORIZED', 'Telegram user and chat are not both allowlisted');
  }
  return { userId, chatId };
}

export function parseSingleUrl(messageText) {
  const trimmed = String(messageText ?? '').trim();
  if (!/^https?:\/\/\S+$/iu.test(trimmed)) throw new SafeStop('TELEGRAM_URL_ONLY', 'Message must contain exactly one HTTP(S) URL');
  return trimmed;
}

export async function processTelegramUpdate({ update, allowlist, store, analyze }) {
  if (!Number.isSafeInteger(update.update_id)) throw new SafeStop('TELEGRAM_UPDATE_INVALID', 'Telegram update_id is required');
  const prior = store.get(update.update_id);
  if (prior) return { ...prior, idempotent_replay: true };
  assertAllowed(update, allowlist);
  const inputUrl = parseSingleUrl(update.message?.text);
  const result = await analyze(inputUrl, update.update_id);
  const stored = { ...result, telegram_update_id: update.update_id, idempotent_replay: false };
  store.put(update.update_id, stored);
  return stored;
}

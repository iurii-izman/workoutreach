import { asSafeResult, SafeStop } from './errors.mjs';
import { makeJobId } from './pipeline.mjs';
import { normalizeUrl } from './url-policy.mjs';

export const BOT_COPY = Object.freeze({
  start: 'Добрый день! Я готовлю проверяемые персонализированные письма для карьерного обращения к интеграторам Bitrix24.\n\nПришлите одним сообщением только публичный URL сайта компании. Я проверю сайт, опубликованный контакт, факт, персональную фразу и верну полный preview.\n\nEmail-отправка пока отключена: кнопка «Отправить» работает только как безопасная проверка.',
  help: 'Как пользоваться:\n\n1. Пришлите один URL вида https://company.example/\n2. Дождитесь подтверждения с номером задания.\n3. Проверьте компанию, адресата, источник, фразу и полный текст письма.\n4. «Перегенерировать» создаёт новый вариант (не более двух раз).\n5. «Отправить» не отправляет email — текущий этап физически заблокирован.\n\nКоманды: /status — состояние безопасности, /version — версия контура.',
  status: 'Статус: бот активен.\nOpenAI: guarded live evaluation.\nTelegram: allowlisted private chat.\nCV: проверяется перед каждым анализом.\nEmail: ОТКЛЮЧЁН.\nOutbox: отсутствует.\nАвтоматическая отправка: невозможна.',
  version: 'Workoutreach stage 1 · guarded live preview · email disabled',
});

function updateIdentity(update) {
  if (update.message) return {
    userId: String(update.message.from?.id ?? ''),
    chatId: String(update.message.chat?.id ?? ''),
    chatType: update.message.chat?.type,
  };
  if (update.callback_query) return {
    userId: String(update.callback_query.from?.id ?? ''),
    chatId: String(update.callback_query.message?.chat?.id ?? ''),
    chatType: update.callback_query.message?.chat?.type,
  };
  return { userId: '', chatId: '', chatType: null };
}

export function isAuthorizedBotUpdate(update, allowlist) {
  const identity = updateIdentity(update);
  return identity.chatType === 'private' && allowlist.userIds.has(identity.userId) && allowlist.chatIds.has(identity.chatId);
}

function friendlyFailure(error) {
  const result = asSafeResult(error);
  const messages = {
    NEEDS_CONTACT: 'На сайте не найден подходящий опубликованный email. Ничего не угадано.',
    NEEDS_REVIEW: 'Найдено несколько равнозначных контактов; требуется ручной выбор.',
    PHRASE_GRAMMAR_AGREEMENT: 'Фраза отклонена языковой проверкой. Попробуйте перегенерацию.',
    PHRASE_WORD_COUNT: 'Фраза отклонена из-за длины. Попробуйте перегенерацию.',
    ROBOTS_BLOCKED: 'robots.txt запрещает обработку этого URL.',
    ROBOTS_UNAVAILABLE: 'Не удалось безопасно проверить robots.txt.',
    MODEL_INCOMPLETE: 'Модель не завершила структурированный ответ. Попробуйте позже.',
    MODEL_REFUSAL: 'Модель отказалась обработать этот материал.',
  };
  return `Задание безопасно остановлено.\nКод: ${result.code}\n${messages[result.code] ?? 'Проверьте URL или повторите попытку позже.'}`;
}

async function withTyping(client, chatId, task) {
  await client.sendChatAction(chatId).catch(() => {});
  const timer = setInterval(() => client.sendChatAction(chatId).catch(() => {}), 4_000);
  timer.unref?.();
  try {
    return await task();
  } finally {
    clearInterval(timer);
  }
}

export function createTelegramBotHandler({ client, allowlist, analyze, maxRegenerations = 2, now = () => Date.now() } = {}) {
  if (!client || !allowlist || typeof analyze !== 'function') throw new TypeError('Telegram bot handler dependencies are required');
  const jobs = new Map();
  const ttlMs = 24 * 60 * 60 * 1000;

  function pruneJobs() {
    const threshold = now() - ttlMs;
    for (const [jobId, job] of jobs) if (job.createdAt < threshold) jobs.delete(jobId);
    while (jobs.size > 100) jobs.delete(jobs.keys().next().value);
  }

  async function executeAnalysis({ inputUrl, chatId, seed, regeneration = 0 }) {
    const jobId = makeJobId(seed);
    jobs.set(jobId, { inputUrl, regeneration, status: 'ANALYZING', createdAt: now() });
    await client.sendText(chatId, `${regeneration ? 'Перегенерация' : 'Принято'} · #${jobId}\nПроверяю сайт, опубликованные контакты и evidence. Обычно это занимает до минуты.`);
    try {
      const result = await withTyping(client, chatId, () => analyze({ inputUrl, seed }));
      if (result.job_id !== jobId) throw new SafeStop('BOT_JOB_ID_MISMATCH', 'Analysis returned an unexpected job identifier');
      const delivery = await client.sendPreview(result.telegram_preview, chatId);
      jobs.set(jobId, { inputUrl, regeneration, status: 'DRAFT_READY', createdAt: now(), delivery });
      return { ok: true, jobId, status: 'DRAFT_READY' };
    } catch (error) {
      const job = jobs.get(jobId);
      if (job) jobs.set(jobId, { ...job, status: 'FAILED' });
      await client.sendText(chatId, friendlyFailure(error)).catch(() => {});
      return { ok: false, jobId, ...asSafeResult(error) };
    }
  }

  async function handleMessage(update) {
    const message = update.message;
    const chatId = String(message.chat.id);
    const text = String(message.text ?? '').trim();
    const command = text.match(/^\/([a-z]+)(?:@[A-Za-z0-9_]+)?(?:\s|$)/iu)?.[1]?.toLowerCase();
    if (command === 'start') { await client.sendText(chatId, BOT_COPY.start); return { ok: true, action: 'start' }; }
    if (command === 'help') { await client.sendText(chatId, BOT_COPY.help); return { ok: true, action: 'help' }; }
    if (command === 'status') { await client.sendText(chatId, BOT_COPY.status); return { ok: true, action: 'status' }; }
    if (command === 'version') { await client.sendText(chatId, BOT_COPY.version); return { ok: true, action: 'version' }; }
    if (command) { await client.sendText(chatId, 'Неизвестная команда. Используйте /help или пришлите один URL сайта компании.'); return { ok: true, action: 'unknown_command' }; }
    if (!text || text.split(/\s+/u).length !== 1) {
      await client.sendText(chatId, 'Пришлите одним сообщением только один публичный URL, например: https://company.example/');
      return { ok: true, action: 'usage' };
    }
    let inputUrl;
    try {
      inputUrl = normalizeUrl(text).href;
    } catch {
      await client.sendText(chatId, 'URL не прошёл безопасную проверку. Разрешены только публичные http/https адреса без логина, fragment и нестандартного порта.');
      return { ok: true, action: 'invalid_url' };
    }
    return executeAnalysis({ inputUrl, chatId, seed: `telegram-update-${update.update_id}` });
  }

  async function handleCallback(update) {
    const callback = update.callback_query;
    const data = String(callback.data ?? '');
    const match = data.match(/^mock_(send|regenerate|reject):(WO-[A-Z0-9]{6})$/u);
    if (!match) {
      await client.answerCallbackQuery(callback.id, { text: 'Действие устарело или некорректно.' });
      return { ok: true, action: 'invalid_callback' };
    }
    const [, action, jobId] = match;
    if (action === 'send') {
      await client.answerCallbackQuery(callback.id, { text: 'Email-отправка физически заблокирована на этапе 1.', showAlert: true });
      return { ok: true, action: 'MOCK_SEND_BLOCKED', jobId };
    }
    if (action === 'reject') {
      await client.answerCallbackQuery(callback.id, { text: 'Черновик отклонён.' });
      if (callback.message?.message_id != null) await client.clearInlineKeyboard(callback.message.chat.id, callback.message.message_id).catch(() => {});
      if (jobs.has(jobId)) jobs.set(jobId, { ...jobs.get(jobId), status: 'REJECTED' });
      return { ok: true, action: 'REJECTED', jobId };
    }
    const job = jobs.get(jobId);
    if (!job || job.status !== 'DRAFT_READY') {
      await client.answerCallbackQuery(callback.id, { text: 'Задание уже недоступно. Пришлите URL повторно.', showAlert: true });
      return { ok: true, action: 'REGENERATION_EXPIRED', jobId };
    }
    if (job.regeneration >= maxRegenerations) {
      await client.answerCallbackQuery(callback.id, { text: 'Лимит перегенераций исчерпан.', showAlert: true });
      return { ok: true, action: 'REGENERATION_LIMIT', jobId };
    }
    await client.answerCallbackQuery(callback.id, { text: 'Перегенерация запущена.' });
    return executeAnalysis({
      inputUrl: job.inputUrl,
      chatId: String(callback.message.chat.id),
      seed: `telegram-update-${update.update_id}-regeneration-${job.regeneration + 1}`,
      regeneration: job.regeneration + 1,
    });
  }

  async function handleUpdate(update) {
    pruneJobs();
    if (!isAuthorizedBotUpdate(update, allowlist)) {
      if (update.callback_query?.id) await client.answerCallbackQuery(update.callback_query.id, { text: 'Доступ запрещён.', showAlert: true }).catch(() => {});
      return { ok: true, ignored: true, reason: 'unauthorized' };
    }
    if (update.message) return handleMessage(update);
    if (update.callback_query) return handleCallback(update);
    return { ok: true, ignored: true, reason: 'unsupported_update' };
  }

  return { handleUpdate, jobs };
}

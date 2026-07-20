import { asSafeResult, SafeStop } from './errors.mjs';
import { makeJobId } from './pipeline.mjs';
import { normalizeUrl } from './url-policy.mjs';

export const BOT_COPY = Object.freeze({
  start: 'Добрый день! Я готовлю проверяемые персонализированные письма для карьерного обращения к интеграторам Bitrix24.\n\nПришлите одним сообщением только публичный URL сайта компании. Я проверю сайт, опубликованный контакт, факт, персональную фразу и верну полный preview.\n\nEmail-отправка пока отключена: кнопка «Отправить» работает только как безопасная проверка.',
  help: 'Как пользоваться:\n\n1. Пришлите один URL вида https://company.example/\n2. Дождитесь подтверждения с номером задания.\n3. Проверьте компанию, адресата, источник, фразу и полный текст письма.\n4. «Перегенерировать» создаёт новый вариант (не более двух раз).\n5. «Отправить» не отправляет email — текущий этап физически заблокирован.\n\nКоманды: /status — состояние безопасности, /version — версия контура.',
  status: 'Статус: бот активен.\nOpenAI: guarded live evaluation.\nTelegram: allowlisted private chat.\nCV: проверяется перед каждым анализом.\nEmail: ОТКЛЮЧЁН.\nOutbox: отсутствует.\nАвтоматическая отправка: невозможна.',
  version: 'Workoutreach stage 1 · guarded live preview · email disabled',
});

const STAGE2_COPY = Object.freeze({
  start: 'Добрый день! Я готовлю проверяемые персонализированные письма для карьерного обращения к интеграторам Bitrix24.\n\nПришлите одним сообщением только публичный URL сайта компании. Задание, evidence, черновик и действия сохраняются в локальном PostgreSQL и переживают перезапуск.\n\nEmail-отправка физически отключена: «Отправить» создаёт только локальную mock-запись.',
  help: 'Как пользоваться:\n\n1. Пришлите один URL вида https://company.example/\n2. Дождитесь preview и проверьте все данные.\n3. «Перегенерировать» создаёт новую неизменяемую версию (максимум две).\n4. «Отклонить» закрывает задание.\n5. «Отправить» создаёт только mock-outbox: email не передаётся наружу.\n\nКоманды: /status или /status WO-XXXXXX, /help, /version.',
  status: 'Статус: локальный Stage 2 активен.\nOpenAI: guarded live evaluation только по вашему URL.\nTelegram: allowlisted long polling.\nСостояние: PostgreSQL.\nEmail: ОТКЛЮЧЁН.\nOutbox: только mock.\nПубличный сервер и webhook: отсутствуют.',
  version: 'Workoutreach local stage 2 · PostgreSQL-backed review · mock outbox · email disabled',
});

const SMTP_COPY = Object.freeze({
  start: 'Добрый день! Пришлите одним сообщением публичный URL сайта компании. Я сохраню evidence и черновик в локальном PostgreSQL. После полного preview кнопка «Отправить email» потребует одно явное подтверждение.',
  help: 'Как пользоваться:\n\n1. Пришлите один публичный URL.\n2. Проверьте адресата, источник, персональную фразу и полный текст.\n3. «Отправить email» создаёт одну локальную команду и отправляет письмо через настроенный SMTP.\n4. Автоматического retry после неизвестного результата нет.\n5. «Перегенерировать» доступно не более двух раз.\n\nКоманды: /status или /status WO-XXXXXX, /help, /version.',
  status: 'Статус: локальная отправка включена.\nOpenAI: только по вашему URL.\nTelegram: allowlisted long polling.\nСостояние: PostgreSQL.\nEmail: SMTP с ручным подтверждением.\nАвтоповтор: отключён.\nПубличный webhook: отсутствует.',
  version: 'Workoutreach guarded SMTP · PostgreSQL-backed review · human approval',
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
    DAILY_ANALYSIS_LIMIT: 'Достигнута настроенная дневная ёмкость анализа. Незавершённые попытки тоже учитываются; новые задания станут доступны после 00:00 UTC.',
    TEMPLATE_NOT_SENDABLE: 'Этот черновик создан до активации проверенного шаблона. Пришлите URL заново, чтобы создать новую безопасную версию.',
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

function stage2Preview(preview, callbacks, mailEnabled = false) {
  return {
    ...preview,
    text: mailEnabled
      ? preview.text.replace('ГОТОВО К ПРОВЕРКЕ (DRY-RUN)', 'ГОТОВО К ПРОВЕРКЕ')
      : preview.text,
    reply_markup: {
      inline_keyboard: [
        [{ text: mailEnabled ? 'Отправить email' : 'Отправить (mock)', callback_data: callbacks.send }],
        [{ text: 'Перегенерировать', callback_data: callbacks.regenerate }],
        [{ text: 'Отклонить', callback_data: callbacks.reject }],
      ],
    },
  };
}

export function createTelegramBotHandler({ client, allowlist, analyze, stateStore = null, maxRegenerations = 2, dailyAnalysisLimit = 2, now = () => Date.now() } = {}) {
  if (!client || !allowlist || typeof analyze !== 'function') throw new TypeError('Telegram bot handler dependencies are required');
  const jobs = new Map();
  const ttlMs = 24 * 60 * 60 * 1000;

  function pruneJobs() {
    const threshold = now() - ttlMs;
    for (const [jobId, job] of jobs) if (job.createdAt < threshold) jobs.delete(jobId);
    while (jobs.size > 100) jobs.delete(jobs.keys().next().value);
  }

  async function executeAnalysis({ inputUrl, chatId, userId, updateId, seed, regeneration = 0, jobId = makeJobId(seed), draftVersion = regeneration + 1, begin = true }) {
    if (stateStore && begin) {
      const started = await stateStore.beginJob({ updateId, jobId, inputUrl, userId, chatId });
      if (started.replay) {
        const status = started.job?.status ?? 'UNKNOWN';
        await client.sendText(chatId, `Обновление уже обработано · #${started.job?.job_id ?? jobId}\nТекущий статус: ${status}.`);
        return { ok: true, jobId: started.job?.job_id ?? jobId, status, idempotentReplay: true };
      }
    }
    if (!stateStore) jobs.set(jobId, { inputUrl, regeneration, status: 'ANALYZING', createdAt: now() });
    try {
      await client.sendText(chatId, `${regeneration ? 'Перегенерация' : 'Принято'} · #${jobId}\nПроверяю сайт, опубликованные контакты и evidence. Обычно это занимает до минуты.`);
      const result = await withTyping(client, chatId, () => analyze({
        inputUrl,
        seed,
        jobId,
        beforeModelCalls: stateStore ? () => stateStore.reserveAnalysis(jobId, draftVersion, dailyAnalysisLimit) : null,
      }));
      if (result.job_id !== jobId) throw new SafeStop('BOT_JOB_ID_MISMATCH', 'Analysis returned an unexpected job identifier');
      let preview = result.telegram_preview;
      if (stateStore) {
        const persisted = await stateStore.persistAnalysis(result, { draftVersion, userId, chatId });
        preview = stage2Preview(preview, persisted.callbacks, persisted.mailEnabled);
      }
      const delivery = await client.sendPreview(preview, chatId);
      if (!stateStore) jobs.set(jobId, { inputUrl, regeneration, status: 'DRAFT_READY', createdAt: now(), delivery });
      return { ok: true, jobId, status: 'DRAFT_READY' };
    } catch (error) {
      if (stateStore) await stateStore.failJob(jobId, asSafeResult(error).code).catch(() => {});
      else {
        const job = jobs.get(jobId);
        if (job) jobs.set(jobId, { ...job, status: 'FAILED' });
      }
      await client.sendText(chatId, friendlyFailure(error)).catch(() => {});
      return { ok: false, jobId, ...asSafeResult(error) };
    }
  }

  async function handleMessage(update) {
    const message = update.message;
    const chatId = String(message.chat.id);
    const text = String(message.text ?? '').trim();
    const command = text.match(/^\/([a-z]+)(?:@[A-Za-z0-9_]+)?(?:\s|$)/iu)?.[1]?.toLowerCase();
    const copy = stateStore?.mailEnabled ? SMTP_COPY : (stateStore ? STAGE2_COPY : BOT_COPY);
    if (command === 'start') { await client.sendText(chatId, copy.start); return { ok: true, action: 'start' }; }
    if (command === 'help') { await client.sendText(chatId, copy.help); return { ok: true, action: 'help' }; }
    if (command === 'status') {
      const jobId = text.match(/\b(WO-[A-Z0-9]{6})\b/u)?.[1];
      if (stateStore && jobId) {
        const job = await stateStore.getAuthorizedJob(jobId, String(message.from.id), chatId);
        const delivery = job?.outbox_status
          ? `${job.outbox_transport}:${job.outbox_status}`
          : 'не создан';
        await client.sendText(chatId, job
          ? `#${job.job_id}\nСтатус задания: ${job.status}\nВерсия черновика: ${job.draft_version ?? '—'}\nOutbox: ${delivery}`
          : 'Задание не найдено или недоступно.');
      } else await client.sendText(chatId, copy.status);
      return { ok: true, action: 'status' };
    }
    if (command === 'version') { await client.sendText(chatId, copy.version); return { ok: true, action: 'version' }; }
    if (command === 'approve') {
      const jobId = text.match(/\b(WO-[A-Z0-9]{6})\b/u)?.[1];
      if (!stateStore?.mailEnabled || !jobId) {
        await client.sendText(chatId, 'Команда доступна только при включённом SMTP: /approve WO-XXXXXX');
        return { ok: true, action: 'approve_unavailable' };
      }
      try {
        const approval = await stateStore.issueExistingSmtpApproval(jobId, String(message.from.id), chatId);
        await client.sendText(chatId, `#${jobId}\nАдресат: ${approval.recipient_email}\nТема: ${approval.subject}\n\nИспользуется уже проверенный неизменяемый черновик версии ${approval.draft_version}.`, {
          replyMarkup: { inline_keyboard: [[{ text: 'Отправить email', callback_data: approval.callbackData }]] },
        });
        return { ok: true, action: 'approve_existing', jobId };
      } catch (error) {
        await client.sendText(chatId, friendlyFailure(error));
        return { ok: false, action: 'approve_existing', ...asSafeResult(error) };
      }
    }
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
    return executeAnalysis({ inputUrl, chatId, userId: String(message.from.id), updateId: update.update_id, seed: `telegram-update-${update.update_id}` });
  }

  async function handleCallback(update) {
    const callback = update.callback_query;
    const data = String(callback.data ?? '');
    const match = stateStore
      ? data.match(/^(mock_send|smtp_send|regenerate|reject):(WO-[A-Z0-9]{6}):[A-Za-z0-9_-]{22,43}$/u)
      : data.match(/^mock_(send|regenerate|reject):(WO-[A-Z0-9]{6})$/u);
    if (!match) {
      await client.answerCallbackQuery(callback.id, { text: 'Действие устарело или некорректно.' });
      return { ok: true, action: 'invalid_callback' };
    }
    const rawAction = match[1];
    const action = ['mock_send', 'smtp_send'].includes(rawAction) ? 'send' : rawAction;
    const jobId = match[2];
    const userId = String(callback.from.id);
    const chatId = String(callback.message.chat.id);
    if (stateStore && action === 'send') {
      const smtp = rawAction === 'smtp_send';
      const result = smtp
        ? await stateStore.approveSmtp({ callbackData: data, userId, chatId, updateId: update.update_id })
        : await stateStore.approveMock({ callbackData: data, userId, chatId, updateId: update.update_id });
      const accepted = smtp
        ? ['SMTP_OUTBOX_CREATED', 'SMTP_OUTBOX_ALREADY_EXISTS'].includes(result.result_code)
        : ['MOCK_OUTBOX_CREATED', 'MOCK_OUTBOX_ALREADY_EXISTS'].includes(result.result_code);
      await client.answerCallbackQuery(callback.id, {
        text: accepted
          ? (smtp ? 'Письмо поставлено в локальную очередь отправки.' : 'Mock-команда сохранена локально. Email не отправлен.')
          : `Действие остановлено: ${result.result_code}.`,
        showAlert: true,
      });
      if (accepted && callback.message?.message_id != null) await client.clearInlineKeyboard(chatId, callback.message.message_id).catch(() => {});
      return { ok: true, action: result.result_code, jobId, outboxId: result.outbox_id ?? null };
    }
    if (!stateStore && action === 'send') {
      await client.answerCallbackQuery(callback.id, { text: 'Email-отправка физически заблокирована на этапе 1.', showAlert: true });
      return { ok: true, action: 'MOCK_SEND_BLOCKED', jobId };
    }
    if (stateStore) {
      const result = await stateStore.applyReviewAction({ callbackData: data, userId, chatId, updateId: update.update_id });
      if (action === 'reject') {
        await client.answerCallbackQuery(callback.id, { text: result.result_code === 'REJECTED' ? 'Черновик отклонён.' : `Действие остановлено: ${result.result_code}.`, showAlert: result.result_code !== 'REJECTED' });
        if (result.result_code === 'REJECTED' && callback.message?.message_id != null) await client.clearInlineKeyboard(chatId, callback.message.message_id).catch(() => {});
        return { ok: true, action: result.result_code, jobId };
      }
      if (result.result_code === 'REGENERATION_LIMIT') {
        await client.answerCallbackQuery(callback.id, { text: 'Лимит перегенераций исчерпан.', showAlert: true });
        return { ok: true, action: result.result_code, jobId };
      }
      if (result.result_code !== 'REGENERATION_STARTED' || result.job_status !== 'ANALYZING') {
        await client.answerCallbackQuery(callback.id, { text: `Действие уже обработано или недоступно: ${result.result_code}.`, showAlert: true });
        return { ok: true, action: result.result_code, jobId };
      }
      await client.answerCallbackQuery(callback.id, { text: 'Перегенерация запущена.' });
      return executeAnalysis({
        inputUrl: result.canonical_url,
        chatId,
        userId,
        updateId: update.update_id,
        seed: `telegram-update-${update.update_id}-regeneration-${Number(result.draft_version) + 1}`,
        regeneration: Number(result.draft_version),
        draftVersion: Number(result.draft_version) + 1,
        jobId,
        begin: false,
      });
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

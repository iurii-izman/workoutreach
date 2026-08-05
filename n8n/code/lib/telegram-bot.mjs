import { asSafeResult, SafeStop } from './errors.mjs';
import { makeJobId } from './pipeline.mjs';
import { normalizeUrl } from './url-policy.mjs';

export const BOT_COPY = Object.freeze({
  start: 'Добрый день! Я нахожу опубликованный email на сайте компании и готовлю фиксированное универсальное письмо для проверки.\n\nПришлите одним сообщением только публичный URL сайта. OpenAI не используется.\n\nEmail-отправка пока отключена: кнопка «Отправить» работает только как безопасная проверка.',
  help: 'Как пользоваться:\n\n1. Пришлите один URL вида https://company.example/\n2. Дождитесь подтверждения с номером задания.\n3. Проверьте адресата, источник и полный неизменяемый текст письма.\n4. «Отправить» не отправляет email — текущий этап физически заблокирован.\n\nКоманды: /status — состояние безопасности, /version — версия контура.',
  status: 'Статус: бот активен.\nКонтент: фиксированное универсальное письмо.\nOpenAI: отключён, ключ не смонтирован.\nTelegram: allowlisted private chat.\nCV: проверяется перед каждым анализом.\nEmail: ОТКЛЮЧЁН.\nOutbox: отсутствует.\nАвтоматическая отправка: невозможна.',
  version: 'Workoutreach universal-only · guarded live preview · email disabled',
});

const STAGE2_COPY = Object.freeze({
  start: 'Добрый день! Я нахожу опубликованный email на сайте компании и готовлю фиксированное универсальное письмо. Задание, источник контакта, черновик и действия сохраняются в локальном PostgreSQL. OpenAI не используется.\n\nEmail-отправка физически отключена: «Отправить» создаёт только локальную mock-запись.',
  help: 'Как пользоваться:\n\n1. Пришлите один URL вида https://company.example/\n2. При нескольких email выберите опубликованный адрес кнопкой; известный адрес: /email WO-XXXXXX name@example.com.\n3. Проверьте адресата, источник и неизменяемый текст письма.\n4. «Отправить» создаёт только mock-outbox: email не передаётся наружу.\n\nКоманды: /next, /queue, /usage, /status [WO-XXXXXX], /help, /version.',
  status: 'Статус: локальный Stage 2 активен.\nКонтент: фиксированное универсальное письмо.\nOpenAI: отключён, ключ не смонтирован.\nTelegram: allowlisted long polling.\nСостояние: PostgreSQL.\nEmail: ОТКЛЮЧЁН.\nOutbox: только mock.\nПубличный сервер и webhook: отсутствуют.',
  version: 'Workoutreach local stage 2 · universal-only · PostgreSQL-backed review · email disabled',
});

const SMTP_COPY = Object.freeze({
  start: 'Добрый день! Пришлите одним сообщением публичный URL сайта компании. Я найду опубликованный email и подготовлю фиксированное универсальное письмо без OpenAI. После полного preview кнопка «Отправить email» потребует одно явное подтверждение.',
  help: 'Как пользоваться:\n\n1. Пришлите один публичный URL.\n2. Если найдено несколько email — выберите опубликованный адрес кнопкой.\n3. Известный адрес можно указать явно: /email WO-XXXXXX name@example.com. Он будет помечен manual.\n4. Проверьте адресата, источник и полный неизменяемый текст, затем подтвердите отправку.\n5. Для FAILED используйте /retry WO-XXXXXX.\n6. Автоматического retry после неизвестного SMTP-результата нет.\n\nКоманды: /next, /queue, /usage, /retry WO-XXXXXX, /status [WO-XXXXXX], /approve WO-XXXXXX, /help, /version.',
  status: 'Статус: локальная отправка включена.\nКонтент: фиксированное универсальное письмо.\nOpenAI: отключён, ключ не смонтирован.\nTelegram: allowlisted long polling.\nСостояние: PostgreSQL.\nEmail: SMTP с ручным подтверждением.\nАвтоповтор: отключён.\nПубличный webhook: отсутствует.',
  version: 'Workoutreach universal-only · guarded SMTP · PostgreSQL-backed review · human approval',
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
    PHRASE_PERSPECTIVE: 'Фраза перепутала роль компании и кандидата. Система попробует новый вариант или сохранит универсальный черновик.',
    PHRASE_FACT_PERSPECTIVE: 'Клиентский кейс ошибочно представлен как внутренняя система компании. Система попробует новый вариант.',
    PHRASE_BRIDGE_FORM: 'Первый абзац не выдержал короткую структуру «факт о компании — человеческая связь». Система попробует новый вариант.',
    PHRASE_SENTENCE_FRAGMENT: 'Первая фраза получилась похожей на заголовок без сказуемого. Система попробует законченный вариант.',
    PHRASE_VAGUE_CONNECTION: 'Связь с компанией сформулирована слишком абстрактно. Система попробует более конкретный вариант.',
    PHRASE_TEMPLATE_REPETITION: 'Первый абзац повторяет сведения из основного письма. Система попробует более лёгкий вариант.',
    PHRASE_STYLE: 'Первый абзац получился перегруженным. Система попробует более короткий и естественный вариант.',
    PHRASE_WORD_COUNT: 'Фраза отклонена из-за длины. Попробуйте перегенерацию.',
    PHRASE_SENTENCE_COUNT: 'Персональный абзац должен состоять из двух коротких фраз. Универсальный черновик будет сохранён, если остальной контур безопасен.',
    ROBOTS_BLOCKED: 'robots.txt запрещает обработку этого URL.',
    ROBOTS_UNAVAILABLE: 'Не удалось безопасно проверить robots.txt.',
    MODEL_INCOMPLETE: 'Модель не завершила структурированный ответ. Попробуйте позже.',
    MODEL_REFUSAL: 'Модель отказалась обработать этот материал.',
    DAILY_ANALYSIS_LIMIT: 'Достигнута настроенная дневная ёмкость анализа. Незавершённые попытки тоже учитываются; новые задания станут доступны после 00:00 UTC.',
    TEMPLATE_NOT_SENDABLE: 'Этот черновик создан до активации проверенного шаблона. Пришлите URL заново, чтобы создать новую безопасную версию.',
    MANUAL_EMAIL_INVALID: 'Ручной адрес не прошёл синтаксическую проверку. Используйте полный адрес вида name@example.com.',
    MANUAL_EMAIL_STATE_INVALID: 'Ручной адрес можно добавить только к активному заданию со статусом NEEDS_CONTACT или NEEDS_REVIEW.',
    CONTACT_SELECTION_STALE: 'Опубликованный адрес не подтвердился при повторной загрузке сайта. Выберите адрес заново.',
    RETRY_STATE_INVALID: 'Команда /retry доступна только для задания со статусом FAILED.',
    RETRY_EXPIRED: 'Срок хранения задания истёк; пришлите URL заново.',
    RETRY_LIMIT: 'Лимит безопасных повторов исчерпан; пришлите URL заново.',
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
  const buttons = [
    [{ text: mailEnabled ? 'Отправить email' : 'Отправить (mock)', callback_data: callbacks.send }],
  ];
  if (callbacks.regenerate) buttons.push([{ text: 'Перегенерировать', callback_data: callbacks.regenerate }]);
  buttons.push([{ text: 'Отклонить', callback_data: callbacks.reject }]);
  return {
    ...preview,
    text: mailEnabled
      ? preview.text.replace('ГОТОВО К ПРОВЕРКЕ (DRY-RUN)', 'ГОТОВО К ПРОВЕРКЕ')
      : preview.text,
    reply_markup: {
      inline_keyboard: buttons,
    },
  };
}

function contactReviewMessage(jobId, review) {
  if (review.status === 'NEEDS_CONTACT') {
    return {
      text: `#${jobId}\nНа сайте не найден подходящий опубликованный email. Ничего не угадано.\n\nЕсли адрес вам достоверно известен, укажите его явно:\n/email ${jobId} name@example.com\n\nТакой источник будет помечен manual.`,
      replyMarkup: null,
    };
  }
  const visible = [...review.candidates.filter((candidate) => candidate.automatic_selection_allowed), ...review.candidates.filter((candidate) => !candidate.automatic_selection_allowed)].slice(0, 25);
  const lines = visible.map((candidate, index) => `${index + 1}. ${candidate.email}\nКатегория: ${candidate.category}${candidate.automatic_selection_allowed ? '' : ' · недоступен по политике'}\nИсточник: ${candidate.source_url}`);
  const omitted = review.candidates.length - visible.length;
  return {
    text: `#${jobId}\nНайдено несколько опубликованных email. Выберите адрес только после проверки категории и источника.\n\n${lines.join('\n\n')}${omitted > 0 ? `\n\nЕщё адресов скрыто: ${omitted}. Используйте явную команду /email после проверки.` : ''}\n\nРучной известный адрес: /email ${jobId} name@example.com`,
    replyMarkup: {
      inline_keyboard: visible.filter((candidate) => candidate.automatic_selection_allowed).map((candidate) => [{
        text: `${candidate.email} · ${candidate.category}`.slice(0, 64),
        callback_data: candidate.callbackData,
      }]),
    },
  };
}

function queueText(summary) {
  const counts = new Map(summary.counts.map((row) => [row.status, Number(row.count)]));
  const header = ['NEEDS_CONTACT', 'NEEDS_REVIEW', 'DRAFT_READY', 'APPROVED', 'SENDING', 'FAILED']
    .map((status) => `${status}: ${counts.get(status) ?? 0}`).join('\n');
  if (summary.jobs.length === 0) return `Очередь пуста.\n\n${header}`;
  const rows = summary.jobs.map((job) => `#${job.job_id} · ${job.status}\n${job.hostname}${job.error_code ? ` · ${job.error_code}` : ''}`);
  return `Текущая очередь:\n${header}\n\n${rows.join('\n\n')}`;
}

function nextText(job) {
  if (!job) return 'Нет заданий, требующих действия. Пришлите URL следующей компании.';
  const instruction = job.status === 'DRAFT_READY'
    ? `Проверьте черновик; для повторного подтверждения: /approve ${job.job_id}`
    : `Откройте сообщение с выбором email или используйте: /email ${job.job_id} name@example.com`;
  return `Следующее действие · #${job.job_id}\n${job.hostname}\nСтатус: ${job.status}\n${instruction}`;
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

  async function executeAnalysis({ inputUrl, chatId, userId, updateId, seed, regeneration = 0, jobId = makeJobId(seed), draftVersion = regeneration + 1, begin = true, contactSelection = null, acceptedFact = null }) {
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
      await client.sendText(chatId, `${regeneration ? 'Повторная проверка' : 'Принято'} · #${jobId}\nПроверяю сайт и опубликованные контакты. Формирую фиксированное письмо без OpenAI. Обычно это занимает до минуты.`);
      const result = await withTyping(client, chatId, () => analyze({
        inputUrl,
        seed,
        jobId,
        contactSelection,
        acceptedFact,
        beforeModelCalls: stateStore ? () => stateStore.reserveAnalysis(jobId, draftVersion, dailyAnalysisLimit) : null,
      }));
      if (result.job_id !== jobId) throw new SafeStop('BOT_JOB_ID_MISMATCH', 'Analysis returned an unexpected job identifier');
      if (stateStore && ['NEEDS_CONTACT', 'NEEDS_REVIEW'].includes(result.status)) {
        const review = await stateStore.persistContactReview(result, { userId, chatId });
        const message = contactReviewMessage(jobId, review);
        await client.sendText(chatId, message.text, { replyMarkup: message.replyMarkup });
        return { ok: true, jobId, status: result.status };
      }
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
    if (command === 'queue') {
      if (!stateStore) { await client.sendText(chatId, 'Очередь доступна только в PostgreSQL runtime.'); return { ok: true, action: 'queue_unavailable' }; }
      const summary = await stateStore.getQueueSummary(String(message.from.id), chatId);
      await client.sendText(chatId, queueText(summary));
      return { ok: true, action: 'queue' };
    }
    if (command === 'next') {
      if (!stateStore) { await client.sendText(chatId, 'Команда доступна только в PostgreSQL runtime.'); return { ok: true, action: 'next_unavailable' }; }
      const job = await stateStore.getNextActionable(String(message.from.id), chatId);
      await client.sendText(chatId, nextText(job));
      return { ok: true, action: 'next', jobId: job?.job_id ?? null };
    }
    if (command === 'usage') {
      if (!stateStore) { await client.sendText(chatId, 'Статистика доступна только в PostgreSQL runtime.'); return { ok: true, action: 'usage_unavailable' }; }
      const usage = await stateStore.getUsageSummary();
      await client.sendText(chatId, `Использование за ${usage.usage_date} UTC\nАнализы: ${usage.analyses_completed} завершено / ${usage.analyses_reserved} зарезервировано / лимит ${dailyAnalysisLimit}\nОшибки после резерва: ${usage.analyses_failed}\nТокены: вход ${usage.input_tokens}, выход ${usage.output_tokens}\nSMTP: ${usage.smtp_accepted} принято провайдером / ${usage.smtp_queued} создано / лимит ${usage.send_limit}`);
      return { ok: true, action: 'usage' };
    }
    if (command === 'retry') {
      const jobId = text.match(/^\/retry(?:@[A-Za-z0-9_]+)?\s+(WO-[A-Z0-9]{6})$/iu)?.[1]?.toUpperCase();
      if (!stateStore || !jobId) {
        await client.sendText(chatId, 'Формат: /retry WO-XXXXXX\nКоманда повторяет только принадлежащее вам задание со статусом FAILED.');
        return { ok: true, action: 'retry_usage' };
      }
      try {
        const retry = await stateStore.prepareRetry({ jobId, userId: String(message.from.id), chatId, updateId: update.update_id });
        if (retry.replay) {
          await client.sendText(chatId, `#${jobId}\nЭта команда уже обработана.`);
          return { ok: true, action: retry.result_code, idempotentReplay: true };
        }
        const acceptedFact = await stateStore.getResumeFact(jobId, String(message.from.id), chatId);
        await client.sendText(chatId, `#${jobId}\nПовтор запущен${acceptedFact ? ' с последнего проверенного fact-stage' : ' с безопасной загрузки сайта'}.`);
        return executeAnalysis({
          inputUrl: retry.canonical_url,
          chatId,
          userId: String(message.from.id),
          updateId: update.update_id,
          seed: `telegram-update-${update.update_id}-retry-${retry.draft_version}`,
          regeneration: retry.draft_version - 1,
          draftVersion: retry.draft_version,
          jobId,
          begin: false,
          acceptedFact,
        });
      } catch (error) {
        await client.sendText(chatId, friendlyFailure(error));
        return { ok: false, action: 'retry', ...asSafeResult(error) };
      }
    }
    if (command === 'email') {
      const match = text.match(/^\/email(?:@[A-Za-z0-9_]+)?\s+(WO-[A-Z0-9]{6})\s+(\S+)$/iu);
      if (!stateStore || !match) {
        await client.sendText(chatId, 'Формат: /email WO-XXXXXX name@example.com\nИспользуйте только достоверно известный адрес; он будет помечен manual.');
        return { ok: true, action: 'manual_email_usage' };
      }
      try {
        const selected = await stateStore.selectManualContact({ jobId: match[1].toUpperCase(), email: match[2], userId: String(message.from.id), chatId, updateId: update.update_id });
        if (selected.replay) { await client.sendText(chatId, 'Эта команда уже обработана.'); return { ok: true, action: selected.result_code, idempotentReplay: true }; }
        const provenanceText = selected.provenance === 'manual' ? 'manual' : 'published (адрес уже был найден на сайте)';
        await client.sendText(chatId, `#${selected.job_id}\nАдрес принят. Источник: ${provenanceText}. Продолжаю анализ без передачи email модели.`);
        return executeAnalysis({
          inputUrl: selected.canonical_url, chatId, userId: String(message.from.id), updateId: update.update_id,
          seed: `telegram-update-${update.update_id}-manual-contact`, jobId: selected.job_id, begin: false,
          contactSelection: selected.selection,
        });
      } catch (error) {
        await client.sendText(chatId, friendlyFailure(error));
        return { ok: false, action: 'manual_email', ...asSafeResult(error) };
      }
    }
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
    if (stateStore && data.startsWith('contact:')) {
      const userId = String(callback.from.id);
      const chatId = String(callback.message.chat.id);
      const selected = await stateStore.selectPublishedContact({ callbackData: data, userId, chatId, updateId: update.update_id });
      if (selected.result_code !== 'CONTACT_SELECTED' || selected.replay) {
        await client.answerCallbackQuery(callback.id, { text: selected.replay ? 'Адрес уже выбран.' : `Выбор остановлен: ${selected.result_code}.`, showAlert: true });
        return { ok: true, action: selected.result_code, jobId: selected.job_id ?? null };
      }
      await client.answerCallbackQuery(callback.id, { text: `Выбран ${selected.contact.email} (${selected.contact.category}).` });
      if (callback.message?.message_id != null) await client.clearInlineKeyboard(chatId, callback.message.message_id).catch(() => {});
      return executeAnalysis({
        inputUrl: selected.canonical_url, chatId, userId, updateId: update.update_id,
        seed: `telegram-update-${update.update_id}-published-contact`, jobId: selected.job_id, begin: false,
        contactSelection: selected.selection,
      });
    }
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
      const acceptedFact = await stateStore.getResumeFact(jobId, userId, chatId);
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
        acceptedFact,
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
    if (update.message) {
      try {
        return await handleMessage(update);
      } catch (error) {
        const safe = asSafeResult(error);
        await client.sendText(String(update.message.chat.id), friendlyFailure(error)).catch(() => {});
        return { ok: false, action: 'message_failed', ...safe };
      }
    }
    if (update.callback_query) {
      try {
        return await handleCallback(update);
      } catch (error) {
        const safe = asSafeResult(error);
        await client.answerCallbackQuery(update.callback_query.id, { text: `Действие безопасно остановлено: ${safe.code}.`, showAlert: true }).catch(() => {});
        const chatId = update.callback_query.message?.chat?.id;
        if (chatId != null) await client.sendText(String(chatId), friendlyFailure(error)).catch(() => {});
        return { ok: false, action: 'callback_failed', ...safe };
      }
    }
    return { ok: true, ignored: true, reason: 'unsupported_update' };
  }

  return { handleUpdate, jobs };
}

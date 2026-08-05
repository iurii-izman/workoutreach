import { SafeStop } from './errors.mjs';

export function renderTelegramPreview({ jobId, siteUrl, recipient, phone, analysis, draft, source, warnings }) {
  const warningText = warnings.length ? warnings.join('; ') : 'нет';
  const phoneText = phone?.selected?.phone ?? (phone?.decision === 'NEEDS_REVIEW' ? 'требует выбора' : 'не найден');
  const attachmentText = draft.attachment?.status === 'VALIDATED'
    ? `${draft.attachment.filename} (проверено)`
    : `${draft.attachment?.filename ?? 'не настроено'} (не проверено)`;
  const personalized = analysis.personalization_mode === 'PERSONALIZED';
  const universalOnly = analysis.personalization_mode === 'UNIVERSAL_ONLY';
  const openingLabel = personalized ? 'ПЕРВЫЙ АБЗАЦ · ПЕРСОНАЛЬНЫЙ' : 'ПЕРВЫЙ АБЗАЦ · УНИВЕРСАЛЬНЫЙ';
  const factText = analysis.fact ?? 'не использовался — универсальный текст не содержит фактов о компании';
  const overlapText = analysis.overlap ?? 'не требуется для owner-approved универсального текста';
  const analysisText = universalOnly
    ? 'РЕЖИМ\nФиксированное универсальное письмо · OpenAI-вызовы: 0\n\n'
    : `${openingLabel}\n${analysis.personalization_phrase}\n\n` +
      `ИСТОЧНИК\n${source.title || source.source_type}\n${source.source_url}\n${analysis.source_excerpt}\n\n` +
      `ПРОВЕРКА\nРежим: ${analysis.personalization_mode}\n` +
      `Факт: ${factText}\n` +
      `Пересечение с предложением: ${overlapText}\n` +
      `Длина: ${analysis.word_count} слов\n`;
  const text = `#${jobId} · ГОТОВО К ПРОВЕРКЕ (DRY-RUN)\n\n` +
    `Компания: ${analysis.company_name}\n` +
    `Сайт: ${siteUrl}\n` +
    `Адресат: ${recipient.email}\n` +
    `Источник адреса: ${recipient.source_url} (${recipient.source_id})\n\n` +
    `Телефон: ${phoneText}\n` +
    `Вложение: ${attachmentText}\n\n` +
    analysisText +
    `Предупреждения: ${warningText}\n\n` +
    `ТЕМА\n${draft.subject}\n\n` +
    `ПИСЬМО\n${draft.body_text}`;

  return {
    transport: 'stub',
    transmitted: false,
    text,
    reply_markup: {
      inline_keyboard: universalOnly
        ? [
          [{ text: 'Отправить (mock)', callback_data: `mock_send:${jobId}` }],
          [{ text: 'Отклонить', callback_data: `mock_reject:${jobId}` }],
        ]
        : [
          [{ text: 'Отправить (mock)', callback_data: `mock_send:${jobId}` }],
          [{ text: 'Перегенерировать', callback_data: `mock_regenerate:${jobId}` }],
          [{ text: 'Отклонить', callback_data: `mock_reject:${jobId}` }],
        ],
    },
  };
}

export function handleMockAction(callbackData) {
  if (!/^mock_(send|regenerate|reject):WO-[A-Z0-9]{6}$/u.test(callbackData)) {
    throw new SafeStop('CALLBACK_INVALID', 'Callback data is outside the stage-1 mock contract');
  }
  const [action, jobId] = callbackData.split(':');
  if (action === 'mock_send') {
    return { jobId, action, result: 'MOCK_SEND_BLOCKED', transmitted: false, outboxCreated: false };
  }
  return { jobId, action, result: 'MOCK_ACTION_RECORDED', transmitted: false, outboxCreated: false };
}

import { SafeStop } from './errors.mjs';

export function renderTelegramPreview({ jobId, siteUrl, recipient, analysis, draft, source, warnings }) {
  const warningText = warnings.length ? warnings.join('; ') : 'нет';
  const text = `#${jobId} · ГОТОВО К ПРОВЕРКЕ (DRY-RUN)\n\n` +
    `Компания: ${analysis.company_name}\n` +
    `Сайт: ${siteUrl}\n` +
    `Адресат: ${recipient.email}\n` +
    `Источник адреса: ${recipient.source_url} (${recipient.source_id})\n\n` +
    `ПЕРСОНАЛЬНАЯ ФРАЗА\n${analysis.personalization_phrase}\n\n` +
    `ИСТОЧНИК\n${source.title || source.source_type}\n${source.source_url}\n${analysis.source_excerpt}\n\n` +
    `ПРОВЕРКА\nФакт: ${analysis.fact}\n` +
    `Пересечение с предложением: ${analysis.overlap}\n` +
    `Длина: ${analysis.word_count} слов\n` +
    `Предупреждения: ${warningText}\n\n` +
    `ТЕМА\n${draft.subject}\n\n` +
    `ПИСЬМО\n${draft.body_text}`;

  return {
    transport: 'stub',
    transmitted: false,
    text,
    reply_markup: {
      inline_keyboard: [
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

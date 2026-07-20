import test from 'node:test';
import assert from 'node:assert/strict';
import { makeJobId } from '../../n8n/code/lib/pipeline.mjs';
import { BOT_COPY, createTelegramBotHandler, isAuthorizedBotUpdate } from '../../n8n/code/lib/telegram-bot.mjs';
import { SafeStop } from '../../n8n/code/lib/errors.mjs';

function createFakeClient() {
  const events = [];
  return {
    events,
    async sendText(chatId, text, options = {}) { events.push({ type: 'text', chatId: String(chatId), text, options }); return [{ message_id: events.length }]; },
    async sendPreview(preview, chatId) { events.push({ type: 'preview', chatId: String(chatId), preview }); return { transmitted: true, message_ids: [events.length] }; },
    async sendChatAction(chatId) { events.push({ type: 'action', chatId: String(chatId) }); return true; },
    async answerCallbackQuery(id, options) { events.push({ type: 'callback', id, options }); return true; },
    async clearInlineKeyboard(chatId, messageId) { events.push({ type: 'clear', chatId: String(chatId), messageId }); return true; },
  };
}

const allowlist = { userIds: new Set(['101']), chatIds: new Set(['202']) };

function messageUpdate(updateId, text, userId = 101, chatId = 202) {
  return { update_id: updateId, message: { from: { id: userId }, chat: { id: chatId, type: 'private' }, text } };
}

test('allowlisted bot commands respond with clear stage-1 safety copy', async () => {
  const client = createFakeClient();
  const handler = createTelegramBotHandler({ client, allowlist, analyze: async () => assert.fail('analysis must not run') });
  const result = await handler.handleUpdate(messageUpdate(1, '/start'));
  assert.equal(result.action, 'start');
  assert.equal(client.events[0].text, BOT_COPY.start);
  assert.match(client.events[0].text, /Email-отправка пока отключена/u);
});

test('one public URL receives acknowledgement, typing and a preview', async () => {
  const client = createFakeClient();
  const handler = createTelegramBotHandler({
    client,
    allowlist,
    analyze: async ({ seed }) => ({ job_id: makeJobId(seed), telegram_preview: { text: 'preview', reply_markup: {} } }),
  });
  const result = await handler.handleUpdate(messageUpdate(2, 'https://example.com/'));
  assert.equal(result.ok, true);
  assert.equal(result.status, 'DRAFT_READY');
  assert.ok(client.events.some((event) => event.type === 'action'));
  assert.ok(client.events.some((event) => event.type === 'preview'));
});

test('send callback is always answered as a physical mock block', async () => {
  const client = createFakeClient();
  const handler = createTelegramBotHandler({ client, allowlist, analyze: async () => assert.fail('analysis must not run') });
  const update = {
    update_id: 3,
    callback_query: {
      id: 'callback-1', from: { id: 101 }, data: 'mock_send:WO-ABC234',
      message: { message_id: 10, chat: { id: 202, type: 'private' } },
    },
  };
  const result = await handler.handleUpdate(update);
  assert.equal(result.action, 'MOCK_SEND_BLOCKED');
  assert.equal(client.events[0].options.showAlert, true);
  assert.match(client.events[0].options.text, /физически заблокирована/u);
});

test('unauthorized private update is ignored without analysis or chat response', async () => {
  const client = createFakeClient();
  let analyzed = false;
  const handler = createTelegramBotHandler({ client, allowlist, analyze: async () => { analyzed = true; } });
  const update = messageUpdate(4, 'https://example.com/', 999, 999);
  assert.equal(isAuthorizedBotUpdate(update, allowlist), false);
  const result = await handler.handleUpdate(update);
  assert.equal(result.ignored, true);
  assert.equal(analyzed, false);
  assert.equal(client.events.length, 0);
});

test('regeneration is explicit and creates a new bounded job', async () => {
  const client = createFakeClient();
  let analyses = 0;
  const handler = createTelegramBotHandler({
    client,
    allowlist,
    maxRegenerations: 2,
    analyze: async ({ seed }) => {
      analyses += 1;
      return { job_id: makeJobId(seed), telegram_preview: { text: `preview-${analyses}`, reply_markup: {} } };
    },
  });
  const first = await handler.handleUpdate(messageUpdate(5, 'https://example.com/'));
  const update = {
    update_id: 6,
    callback_query: {
      id: 'callback-2', from: { id: 101 }, data: `mock_regenerate:${first.jobId}`,
      message: { message_id: 11, chat: { id: 202, type: 'private' } },
    },
  };
  const regenerated = await handler.handleUpdate(update);
  assert.equal(regenerated.ok, true);
  assert.equal(analyses, 2);
  assert.notEqual(regenerated.jobId, first.jobId);
});

test('local stage-2 state store reserves budget, persists preview and creates only mock outbox', async () => {
  const client = createFakeClient();
  const calls = [];
  let persistedJobId;
  const nonce = 'abcdefghijklmnopqrstuv';
  const stateStore = {
    async beginJob(input) { calls.push(['begin', input.updateId]); return { created: true, replay: false }; },
    async reserveAnalysis(jobId, version, limit) { calls.push(['reserve', jobId, version, limit]); },
    async persistAnalysis(result) {
      persistedJobId = result.job_id;
      calls.push(['persist', result.job_id]);
      return {
        callbacks: {
          send: `mock_send:${result.job_id}:${nonce}`,
          regenerate: `regenerate:${result.job_id}:${nonce}`,
          reject: `reject:${result.job_id}:${nonce}`,
        },
      };
    },
    async failJob() { assert.fail('successful analysis must not fail'); },
    async approveMock(input) { calls.push(['approve', input.callbackData]); return { result_code: 'MOCK_OUTBOX_CREATED', outbox_id: 7 }; },
  };
  const handler = createTelegramBotHandler({
    client,
    allowlist,
    stateStore,
    dailyAnalysisLimit: 2,
    analyze: async ({ jobId, beforeModelCalls }) => {
      await beforeModelCalls();
      return { job_id: jobId, telegram_preview: { text: 'preview', reply_markup: {} } };
    },
  });

  const created = await handler.handleUpdate(messageUpdate(20, 'https://example.com/'));
  assert.equal(created.status, 'DRAFT_READY');
  assert.deepEqual(calls.slice(0, 3).map((entry) => entry[0]), ['begin', 'reserve', 'persist']);
  assert.equal(calls[1][3], 2);
  const preview = client.events.find((event) => event.type === 'preview').preview;
  assert.equal(preview.reply_markup.inline_keyboard[0][0].callback_data, `mock_send:${persistedJobId}:${nonce}`);

  const approved = await handler.handleUpdate({
    update_id: 21,
    callback_query: {
      id: 'callback-stage2', from: { id: 101 }, data: `mock_send:${persistedJobId}:${nonce}`,
      message: { message_id: 15, chat: { id: 202, type: 'private' } },
    },
  });
  assert.equal(approved.action, 'MOCK_OUTBOX_CREATED');
  assert.equal(calls.at(-1)[0], 'approve');
  assert.match(client.events.find((event) => event.id === 'callback-stage2').options.text, /Email не отправлен/u);
});

test('SMTP-enabled preview removes the obsolete dry-run label', async () => {
  const client = createFakeClient();
  const nonce = 'abcdefghijklmnopqrstuv';
  const stateStore = {
    mailEnabled: true,
    async beginJob() { return { created: true, replay: false }; },
    async reserveAnalysis() {},
    async persistAnalysis(result) {
      return {
        mailEnabled: true,
        callbacks: {
          send: `smtp_send:${result.job_id}:${nonce}`,
          regenerate: `regenerate:${result.job_id}:${nonce}`,
          reject: `reject:${result.job_id}:${nonce}`,
        },
      };
    },
    async failJob() { assert.fail('successful analysis must not fail'); },
  };
  const handler = createTelegramBotHandler({
    client,
    allowlist,
    stateStore,
    analyze: async ({ jobId, beforeModelCalls }) => {
      await beforeModelCalls();
      return { job_id: jobId, telegram_preview: { text: `#${jobId} · ГОТОВО К ПРОВЕРКЕ (DRY-RUN)`, reply_markup: {} } };
    },
  });

  await handler.handleUpdate(messageUpdate(23, 'https://example.com/'));
  const preview = client.events.find((event) => event.type === 'preview').preview;
  assert.match(preview.text, /ГОТОВО К ПРОВЕРКЕ$/u);
  assert.doesNotMatch(preview.text, /DRY-RUN/u);
  assert.equal(preview.reply_markup.inline_keyboard[0][0].text, 'Отправить email');
});

test('crawl failure before the model boundary does not reserve OpenAI budget', async () => {
  const client = createFakeClient();
  let reserved = false;
  const stateStore = {
    async beginJob() { return { created: true, replay: false }; },
    async reserveAnalysis() { reserved = true; },
    async failJob() {},
  };
  const handler = createTelegramBotHandler({
    client,
    allowlist,
    stateStore,
    analyze: async () => { throw new SafeStop('FETCH_HTTP_STATUS', 'missing', { status: 404 }); },
  });
  const result = await handler.handleUpdate(messageUpdate(22, 'https://example.com/'));
  assert.equal(result.code, 'FETCH_HTTP_STATUS');
  assert.equal(reserved, false);
});

test('/approve reuses an owned immutable draft without another model call', async () => {
  const client = createFakeClient();
  const stateStore = {
    mailEnabled: true,
    async issueExistingSmtpApproval(jobId) {
      assert.equal(jobId, 'WO-ABC234');
      return { recipient_email: 'recipient@example.com', subject: 'Subject', draft_version: 1, callbackData: 'smtp_send:WO-ABC234:abcdefghijklmnopqrstuv' };
    },
  };
  const handler = createTelegramBotHandler({ client, allowlist, stateStore, analyze: async () => assert.fail('analysis must not run') });
  const result = await handler.handleUpdate(messageUpdate(30, '/approve WO-ABC234'));
  assert.equal(result.action, 'approve_existing');
  assert.match(client.events[0].text, /неизменяемый черновик версии 1/u);
  assert.equal(client.events[0].options.replyMarkup.inline_keyboard[0][0].callback_data, 'smtp_send:WO-ABC234:abcdefghijklmnopqrstuv');
});

test('/approve explains why a legacy non-sendable draft must be recreated', async () => {
  const client = createFakeClient();
  const stateStore = {
    mailEnabled: true,
    async issueExistingSmtpApproval() { throw new SafeStop('TEMPLATE_NOT_SENDABLE', 'legacy'); },
  };
  const handler = createTelegramBotHandler({ client, allowlist, stateStore, analyze: async () => assert.fail('analysis must not run') });
  const result = await handler.handleUpdate(messageUpdate(31, '/approve WO-ABC234'));
  assert.equal(result.code, 'TEMPLATE_NOT_SENDABLE');
  assert.match(client.events[0].text, /Пришлите URL заново/u);
});

test('contact review shows published email category/source and does not reserve model budget', async () => {
  const client = createFakeClient();
  let reserved = false;
  const stateStore = {
    async beginJob() { return { created: true, replay: false }; },
    async reserveAnalysis() { reserved = true; },
    async persistContactReview() {
      return {
        status: 'NEEDS_REVIEW',
        candidates: [
          { id: 7, email: 'hr@example.com', category: 'recruiting', source_url: 'https://example.com/contacts', provenance: 'published', automatic_selection_allowed: true, callbackData: 'contact:WO-ABC234:7:abcdefghijklmnopqrstuv' },
          { id: 8, email: 'legal@example.com', category: 'privacy_or_legal', source_url: 'https://example.com/privacy', provenance: 'published', automatic_selection_allowed: false, callbackData: 'contact:WO-ABC234:8:abcdefghijklmnopqrstuv' },
        ],
      };
    },
    async failJob() { assert.fail('contact review must not fail the job'); },
  };
  const handler = createTelegramBotHandler({
    client, allowlist, stateStore,
    analyze: async ({ jobId }) => ({ job_id: jobId, status: 'NEEDS_REVIEW' }),
  });
  const result = await handler.handleUpdate(messageUpdate(40, 'https://example.com/'));
  assert.equal(result.status, 'NEEDS_REVIEW');
  assert.equal(reserved, false);
  const message = client.events.find((event) => event.type === 'text' && /Категория:/u.test(event.text));
  assert.match(message.text, /hr@example\.com/u);
  assert.match(message.text, /https:\/\/example\.com\/contacts/u);
  assert.match(message.text, /privacy_or_legal · недоступен по политике/u);
  assert.equal(message.options.replyMarkup.inline_keyboard.length, 1);
  assert.equal(message.options.replyMarkup.inline_keyboard[0][0].callback_data, 'contact:WO-ABC234:7:abcdefghijklmnopqrstuv');
});

test('manual email command explicitly selects manual provenance and continues the same job', async () => {
  const client = createFakeClient();
  let receivedSelection;
  const nonce = 'abcdefghijklmnopqrstuv';
  const stateStore = {
    mailEnabled: true,
    async selectManualContact({ jobId, email }) {
      assert.equal(jobId, 'WO-ABC234');
      assert.equal(email, 'known@example.com');
      return { result_code: 'MANUAL_CONTACT_SELECTED', job_id: jobId, canonical_url: 'https://example.com/', provenance: 'manual', selection: { type: 'manual', email } };
    },
    async reserveAnalysis() {},
    async persistAnalysis(result) {
      return { mailEnabled: true, callbacks: { send: `smtp_send:${result.job_id}:${nonce}`, regenerate: `regenerate:${result.job_id}:${nonce}`, reject: `reject:${result.job_id}:${nonce}` } };
    },
    async failJob() { assert.fail('manual selection flow must succeed'); },
  };
  const handler = createTelegramBotHandler({
    client, allowlist, stateStore,
    analyze: async ({ jobId, contactSelection, beforeModelCalls }) => {
      receivedSelection = contactSelection;
      await beforeModelCalls();
      return { job_id: jobId, status: 'DRAFT_READY', telegram_preview: { text: 'preview', reply_markup: {} } };
    },
  });
  const result = await handler.handleUpdate(messageUpdate(41, '/email WO-ABC234 known@example.com'));
  assert.equal(result.status, 'DRAFT_READY');
  assert.deepEqual(receivedSelection, { type: 'manual', email: 'known@example.com' });
  assert.match(client.events[0].text, /помечен: manual/u);
});

test('/queue, /next and /usage read operational state without analysis', async () => {
  const client = createFakeClient();
  const stateStore = {
    async getQueueSummary() { return { counts: [{ status: 'DRAFT_READY', count: 1 }], jobs: [{ job_id: 'WO-ABC234', hostname: 'example.com', status: 'DRAFT_READY', error_code: null }] }; },
    async getNextActionable() { return { job_id: 'WO-ABC234', hostname: 'example.com', status: 'DRAFT_READY' }; },
    async getUsageSummary() { return { usage_date: '2026-07-20', analyses_completed: 2, analyses_reserved: 2, analyses_failed: 0, input_tokens: 10, output_tokens: 5, smtp_accepted: 1, smtp_queued: 1, send_limit: 30 }; },
  };
  const handler = createTelegramBotHandler({ client, allowlist, stateStore, dailyAnalysisLimit: 40, analyze: async () => assert.fail('analysis must not run') });
  assert.equal((await handler.handleUpdate(messageUpdate(42, '/queue'))).action, 'queue');
  assert.equal((await handler.handleUpdate(messageUpdate(43, '/next'))).jobId, 'WO-ABC234');
  assert.equal((await handler.handleUpdate(messageUpdate(44, '/usage'))).action, 'usage');
  assert.ok(client.events.some((event) => /SMTP: 1 принято/u.test(event.text)));
});

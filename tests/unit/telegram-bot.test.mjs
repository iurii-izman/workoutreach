import test from 'node:test';
import assert from 'node:assert/strict';
import { makeJobId } from '../../n8n/code/lib/pipeline.mjs';
import { BOT_COPY, createTelegramBotHandler, isAuthorizedBotUpdate } from '../../n8n/code/lib/telegram-bot.mjs';

function createFakeClient() {
  const events = [];
  return {
    events,
    async sendText(chatId, text) { events.push({ type: 'text', chatId: String(chatId), text }); return [{ message_id: events.length }]; },
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

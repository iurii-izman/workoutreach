import test from 'node:test';
import assert from 'node:assert/strict';
import { createTelegramClient, splitTelegramText } from '../../n8n/code/lib/telegram-api.mjs';

const fakeToken = `${'1'.repeat(10)}:${'A'.repeat(30)}`;

test('Telegram preview chunks safely and attaches mock buttons only to the final message', async () => {
  const payloads = [];
  const client = createTelegramClient({
    botToken: fakeToken,
    allowedChatIds: new Set(['202']),
    fetchImpl: async (_url, options) => {
      payloads.push(JSON.parse(options.body));
      return { ok: true, status: 200, json: async () => ({ ok: true, result: { message_id: payloads.length } }) };
    },
  });
  const preview = { text: `${'Фраза '.repeat(700)}\n\nПисьмо`, reply_markup: { inline_keyboard: [[{ text: 'mock', callback_data: 'mock_send:WO-ABC234' }]] } };
  const result = await client.sendPreview(preview, '202');
  assert.ok(result.chunk_count > 1);
  assert.ok(payloads.every((payload) => payload.text.length <= 3900));
  assert.equal('reply_markup' in payloads[0], false);
  assert.deepEqual(payloads.at(-1).reply_markup, preview.reply_markup);
});

test('Telegram client blocks a non-allowlisted chat before network access', async () => {
  let called = false;
  const client = createTelegramClient({ botToken: fakeToken, allowedChatIds: new Set(['202']), fetchImpl: async () => { called = true; } });
  await assert.rejects(client.sendPreview({ text: 'test', reply_markup: {} }, '999'), { code: 'TELEGRAM_UNAUTHORIZED' });
  assert.equal(called, false);
});

test('Telegram text splitter never exceeds the API character limit', () => {
  assert.ok(splitTelegramText('x'.repeat(9000)).every((part) => part.length <= 3900));
});

test('Telegram long polling uses explicit offset and only message/callback updates', async () => {
  let payload;
  const client = createTelegramClient({
    botToken: fakeToken,
    allowedChatIds: new Set(['202']),
    fetchImpl: async (_url, options) => {
      payload = JSON.parse(options.body);
      return { ok: true, status: 200, json: async () => ({ ok: true, result: [] }) };
    },
  });
  assert.deepEqual(await client.getUpdates(42, 25), []);
  assert.equal(payload.offset, 42);
  assert.equal(payload.timeout, 25);
  assert.deepEqual(payload.allowed_updates, ['message', 'callback_query']);
});

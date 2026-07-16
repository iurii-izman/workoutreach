import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryDryRunStore, processTelegramUpdate } from '../../n8n/code/lib/ingest.mjs';
import { createFixtureFetcher, createModelStub } from '../../n8n/code/lib/fixture-adapters.mjs';
import { analyzeDryRun, loadOfferProfile } from '../../n8n/code/lib/pipeline.mjs';
import { handleMockAction } from '../../n8n/code/lib/telegram.mjs';

const root = decodeURIComponent(new URL('../../', import.meta.url).pathname.replace(/^\/(?:[A-Za-z]:)/u, (match) => match.slice(1)));
const allowlist = { userIds: new Set(['101']), chatIds: new Set(['202']) };
const update = { update_id: 1001, message: { from: { id: 101 }, chat: { id: 202 }, text: 'https://synthetic-company.example/' } };

async function analyzer(inputUrl, seed) {
  return analyzeDryRun({
    root, inputUrl, seed,
    fetcher: await createFixtureFetcher(root, 'synthetic-company'),
    modelAdapter: await createModelStub(root, 'synthetic-company'),
    offerProfile: await loadOfferProfile(root, 'fixtures/offer-profile.synthetic-eval.v1.yaml'),
  });
}

test('allowlisted Telegram update gets one preview and replay is idempotent', async () => {
  const store = new MemoryDryRunStore();
  const first = await processTelegramUpdate({ update, allowlist, store, analyze: analyzer });
  const replay = await processTelegramUpdate({ update, allowlist, store, analyze: analyzer });
  assert.equal(first.idempotent_replay, false);
  assert.equal(replay.idempotent_replay, true);
  assert.equal(first.job_id, replay.job_id);
  assert.equal(store.size, 1);
  assert.match(first.telegram_preview.text, new RegExp(`#${first.job_id}`, 'u'));
});

test('user and chat must both be allowlisted', async () => {
  const unauthorized = structuredClone(update);
  unauthorized.update_id = 1002;
  unauthorized.message.chat.id = 999;
  await assert.rejects(processTelegramUpdate({ update: unauthorized, allowlist, store: new MemoryDryRunStore(), analyze: analyzer }), { code: 'TELEGRAM_UNAUTHORIZED' });
});

test('send button is a physical mock block with no outbox', () => {
  const result = handleMockAction('mock_send:WO-ABC234');
  assert.deepEqual(result, { jobId: 'WO-ABC234', action: 'mock_send', result: 'MOCK_SEND_BLOCKED', transmitted: false, outboxCreated: false });
});

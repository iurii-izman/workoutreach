import test from 'node:test';
import assert from 'node:assert/strict';
import { createOpenAIAdapter } from '../../n8n/code/lib/openai.mjs';

const safeRequest = {
  model: 'test-model', store: false, tools: [], truncation: 'disabled',
  text: { format: { type: 'json_schema', strict: true, schema: { type: 'object' } } },
};
const fakeKey = `s${'k'}-${'test'.repeat(10)}`;

function fakeResponse(payload, { ok = true, status = 200 } = {}) {
  return { ok, status, headers: { get: () => null }, json: async () => payload };
}

test('OpenAI adapter parses exactly one structured output without exposing tools or storage', async () => {
  let requestBody;
  const adapter = createOpenAIAdapter({
    apiKey: fakeKey,
    fetchImpl: async (_url, options) => {
      requestBody = JSON.parse(options.body);
      return fakeResponse({
        id: 'resp_test', status: 'completed', model: 'test-model', service_tier: 'default', usage: {
          input_tokens: 10, output_tokens: 5, total_tokens: 15,
          input_tokens_details: { cached_tokens: 2, cache_write_tokens: 4 },
          output_tokens_details: { reasoning_tokens: 3 },
        },
        output: [{ type: 'message', content: [{ type: 'output_text', text: '{"accepted":true}' }] }],
      });
    },
  });
  const result = await adapter.fact(safeRequest);
  assert.deepEqual(result.output, { accepted: true });
  assert.equal(result.metadata.total_tokens, undefined);
  assert.equal(result.metadata.usage.total_tokens, 15);
  assert.equal(result.metadata.service_tier, 'default');
  assert.equal(result.metadata.usage.input_tokens_details.cached_tokens, 2);
  assert.equal(result.metadata.usage.input_tokens_details.cache_write_tokens, 4);
  assert.equal(result.metadata.usage.output_tokens_details.reasoning_tokens, 3);
  assert.equal(requestBody.store, false);
  assert.deepEqual(requestBody.tools, []);
});

test('OpenAI adapter preserves refusal and incomplete as controlled envelopes', async () => {
  const refusal = createOpenAIAdapter({
    apiKey: fakeKey,
    fetchImpl: async () => fakeResponse({ status: 'completed', output: [{ content: [{ type: 'refusal', refusal: 'declined' }] }] }),
  });
  assert.equal((await refusal.fact(safeRequest)).refusal, 'MODEL_REFUSED');

  const incomplete = createOpenAIAdapter({
    apiKey: fakeKey,
    fetchImpl: async () => fakeResponse({ status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, output: [] }),
  });
  assert.equal((await incomplete.fact(safeRequest)).status, 'incomplete');
});

test('OpenAI adapter rejects unsafe requests before network access', async () => {
  let called = false;
  const adapter = createOpenAIAdapter({
    apiKey: fakeKey,
    fetchImpl: async () => { called = true; return fakeResponse({}); },
  });
  await assert.rejects(adapter.fact({ ...safeRequest, store: true }), { code: 'MODEL_REQUEST_UNSAFE' });
  assert.equal(called, false);
});

test('OpenAI adapter retries only transient HTTP failures within the fixed budget', async () => {
  let calls = 0;
  const delays = [];
  const adapter = createOpenAIAdapter({
    apiKey: fakeKey,
    random: () => 0,
    sleep: async (milliseconds) => delays.push(milliseconds),
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) return fakeResponse({}, { ok: false, status: 429 });
      return fakeResponse({ status: 'completed', output: [{ content: [{ type: 'output_text', text: '{"accepted":true}' }] }] });
    },
  });
  assert.deepEqual((await adapter.fact(safeRequest)).output, { accepted: true });
  assert.equal(calls, 2);
  assert.deepEqual(delays, [250]);
});

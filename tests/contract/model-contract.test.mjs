import test from 'node:test';
import assert from 'node:assert/strict';
import { assertCompletedModelEnvelope, assertSchema, buildFactRequest, buildPhraseRequest, loadModelContracts } from '../../n8n/code/lib/model-contract.mjs';

const root = decodeURIComponent(new URL('../../', import.meta.url).pathname.replace(/^\/(?:[A-Za-z]:)/u, (match) => match.slice(1)));
const contracts = await loadModelContracts(root);

const validFact = {
  company_name: 'Acme', fact: 'Acme создала сервис.', source_id: 'p01', source_excerpt: 'Acme создала сервис.', source_type: 'about', published_at: null,
  confidence: 0.8, decision: 'READY_FOR_REVIEW', warnings: [],
};

test('canonical schemas reject missing and additional fields', () => {
  assert.throws(() => assertSchema(contracts.validateFact, { ...validFact, action: 'send' }, 'FACT_SCHEMA_INVALID'), { code: 'FACT_SCHEMA_INVALID' });
  const { fact, ...missing } = validFact;
  assert.throws(() => assertSchema(contracts.validateFact, missing, 'FACT_SCHEMA_INVALID'), { code: 'FACT_SCHEMA_INVALID' });
});

test('refusal and incomplete envelopes are controlled stops', () => {
  assert.throws(() => assertCompletedModelEnvelope({ status: 'completed', refusal: 'no' }), { code: 'MODEL_REFUSAL' });
  assert.throws(() => assertCompletedModelEnvelope({ status: 'incomplete' }), { code: 'MODEL_INCOMPLETE' });
});

test('request A and B use strict JSON Schema, Store=false, and no tools', async () => {
  const page = { source_id: 'p01', source_type: 'about', text: 'Acme создала сервис.' };
  const factRequest = await buildFactRequest(root, [page]);
  const phraseRequest = await buildPhraseRequest(root, validFact, { locale: 'ru', claims: [{ id: 'claim-1', text: 'Allowed' }] });
  for (const request of [factRequest, phraseRequest]) {
    assert.equal(request.store, false);
    assert.deepEqual(request.tools, []);
    assert.equal(request.text.format.type, 'json_schema');
    assert.equal(request.text.format.strict, true);
  }
  const phrasePayload = JSON.parse(phraseRequest.input[0].content);
  assert.equal('sources' in phrasePayload, false);
  assert.equal('pages' in phrasePayload, false);
});

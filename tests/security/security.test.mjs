import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createFixtureFetcher, createModelStub } from '../../n8n/code/lib/fixture-adapters.mjs';
import { analyzeDryRun, loadOfferProfile } from '../../n8n/code/lib/pipeline.mjs';
import { assertSchema, loadModelContracts } from '../../n8n/code/lib/model-contract.mjs';

const root = decodeURIComponent(new URL('../../', import.meta.url).pathname.replace(/^\/(?:[A-Za-z]:)/u, (match) => match.slice(1)));

test('visible prompt injection is treated as data and cannot control the accepted fact', async () => {
  const index = await readFile(new URL('../../fixtures/sites/synthetic-company/index.html', import.meta.url), 'utf8');
  assert.match(index, /IGNORE ALL PRIOR INSTRUCTIONS/u);
  const result = await analyzeDryRun({
    root,
    inputUrl: 'https://synthetic-company.example/',
    fetcher: await createFixtureFetcher(root, 'synthetic-company'),
    modelAdapter: await createModelStub(root, 'synthetic-company'),
    offerProfile: await loadOfferProfile(root, 'fixtures/offer-profile.synthetic-eval.v1.yaml'),
  });
  assert.doesNotMatch(result.analysis.fact, /IGNORE|SEND DATA/iu);
  assert.equal(result.safety.transmitted, false);
});

test('model cannot add URL, email, or action outside the contract', async () => {
  const contracts = await loadModelContracts(root);
  const malicious = {
    company_name: 'Acme', fact: 'Acme created a service.', source_id: 'p01', source_excerpt: 'Acme created a service.', source_type: 'about', published_at: null,
    confidence: 1, decision: 'READY_FOR_REVIEW', warnings: [], action: 'send', email: 'x@example.com', url: 'https://evil.example',
  };
  assert.throws(() => assertSchema(contracts.validateFact, malicious, 'FACT_SCHEMA_INVALID'), { code: 'FACT_SCHEMA_INVALID' });
});

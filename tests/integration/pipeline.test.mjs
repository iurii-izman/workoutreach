import test from 'node:test';
import assert from 'node:assert/strict';
import { createFixtureFetcher, createModelStub } from '../../n8n/code/lib/fixture-adapters.mjs';
import { analyzeDryRun, loadOfferProfile } from '../../n8n/code/lib/pipeline.mjs';

const root = decodeURIComponent(new URL('../../', import.meta.url).pathname.replace(/^\/(?:[A-Za-z]:)/u, (match) => match.slice(1)));

test('synthetic end-to-end pipeline produces a full non-transmitted preview with evidence', async () => {
  const result = await analyzeDryRun({
    root,
    inputUrl: 'https://synthetic-company.example/',
    fetcher: await createFixtureFetcher(root, 'synthetic-company'),
    modelAdapter: await createModelStub(root, 'synthetic-company'),
    offerProfile: await loadOfferProfile(root, 'fixtures/offer-profile.synthetic-eval.v1.yaml'),
    seed: 'integration-1',
  });
  assert.equal(result.status, 'DRAFT_READY');
  assert.equal(result.crawl.page_count, 3);
  assert.equal(result.contact.selected.email, 'hello@synthetic-company.example');
  assert.equal(result.analysis.decision, 'READY_FOR_REVIEW');
  assert.equal(result.draft.sendable, false);
  assert.equal(result.telegram_preview.transmitted, false);
  assert.match(result.telegram_preview.text, /ПЕРСОНАЛЬНАЯ ФРАЗА/u);
  assert.match(result.telegram_preview.text, /ИСТОЧНИК/u);
  assert.deepEqual(result.evidence.evidence_checks, ['source_id', 'source_type', 'excerpt_literal', 'fact_literal', 'company', 'published_at']);
});

test('unapproved production placeholder stops before analysis', async () => {
  await assert.rejects(analyzeDryRun({
    root,
    inputUrl: 'https://synthetic-company.example/',
    fetcher: await createFixtureFetcher(root, 'synthetic-company'),
    modelAdapter: await createModelStub(root, 'synthetic-company'),
    offerProfile: await loadOfferProfile(root),
  }), { code: 'OFFER_NOT_APPROVED' });
});

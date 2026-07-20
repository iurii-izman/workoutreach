import test from 'node:test';
import assert from 'node:assert/strict';
import { createFixtureFetcher, createModelStub } from '../../n8n/code/lib/fixture-adapters.mjs';
import { analyzeDryRun, compactEvidenceExcerpt, loadOfferProfile } from '../../n8n/code/lib/pipeline.mjs';

const root = decodeURIComponent(new URL('../../', import.meta.url).pathname.replace(/^\/(?:[A-Za-z]:)/u, (match) => match.slice(1)));

test('synthetic end-to-end pipeline produces a full non-transmitted preview with evidence', async () => {
  let budgetReservations = 0;
  const result = await analyzeDryRun({
    root,
    inputUrl: 'https://synthetic-company.example/',
    fetcher: await createFixtureFetcher(root, 'synthetic-company'),
    modelAdapter: await createModelStub(root, 'synthetic-company'),
    offerProfile: await loadOfferProfile(root, 'fixtures/offer-profile.synthetic-eval.v1.yaml'),
    beforeModelCalls: async () => { budgetReservations += 1; },
    seed: 'integration-1',
  });
  assert.equal(result.status, 'DRAFT_READY');
  assert.equal(budgetReservations, 1);
  assert.equal(result.crawl.page_count, 3);
  assert.deepEqual(result.crawl.skipped_pages, []);
  assert.equal(result.contact.selected.email, 'hello@synthetic-company.example');
  assert.equal(result.analysis.decision, 'READY_FOR_REVIEW');
  assert.ok(result.analysis.source_excerpt.length <= 500);
  assert.match(result.analysis.source_excerpt, /Синтетика Лаб разработала учебный сервис/u);
  assert.equal(result.draft.sendable, true);
  assert.equal(result.safety.live_send_enabled, false);
  assert.equal(result.telegram_preview.transmitted, false);
  assert.match(result.telegram_preview.text, /ПЕРСОНАЛЬНАЯ ФРАЗА/u);
  assert.match(result.telegram_preview.text, /ИСТОЧНИК/u);
  assert.deepEqual(result.evidence.evidence_checks, ['source_id', 'source_type', 'excerpt_literal', 'fact_literal', 'company', 'published_at']);
});

test('owner campaign profile is approved but cannot enable email transmission', async () => {
  const profile = await loadOfferProfile(root);
  assert.equal(profile.owner_approved, true);
  assert.equal(profile.campaign_type, 'career_outreach');
  assert.equal(profile.sendable, false);
  assert.ok(profile.claims.length > 0);
});

test('compact evidence keeps the accepted fact and does not cut boundary words', () => {
  const prefix = 'начало '.repeat(100);
  const fact = 'Подтверждённый факт о CRM.';
  const excerpt = compactEvidenceExcerpt(`${prefix}${fact} ${'конец '.repeat(100)}`, fact, 160);
  assert.match(excerpt, /Подтверждённый факт о CRM\./u);
  assert.doesNotMatch(excerpt, /^ачало|^онец/u);
  assert.doesNotMatch(excerpt, /\sнача$/u);
});

test('compact evidence prefers a nearby sentence boundary before the fact', () => {
  const fact = 'Настраиваем Битрикс24 под ключ.';
  const excerpt = compactEvidenceExcerpt(`${'далёкий контекст '.repeat(20)}Завершённая мысль! Важный контекст. ${fact} ${'хвост '.repeat(50)}`, fact, 180);
  assert.match(excerpt, /^Важный контекст\. Настраиваем Битрикс24 под ключ\./u);
});

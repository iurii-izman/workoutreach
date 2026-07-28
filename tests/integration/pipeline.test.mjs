import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createFixtureFetcher, createModelStub } from '../../n8n/code/lib/fixture-adapters.mjs';
import { analyzeDryRun, compactEvidenceExcerpt, loadOfferProfile, repairPhraseFormatting } from '../../n8n/code/lib/pipeline.mjs';

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
  assert.equal(result.analysis.personalization_mode, 'PERSONALIZED');
  assert.ok(result.analysis.source_excerpt.length <= 500);
  assert.match(result.analysis.source_excerpt, /Синтетика Лаб разработала учебный сервис/u);
  assert.equal(result.draft.sendable, true);
  assert.equal(result.safety.live_send_enabled, false);
  assert.equal(result.telegram_preview.transmitted, false);
  assert.match(result.telegram_preview.text, /ПЕРВЫЙ АБЗАЦ · ПЕРСОНАЛЬНЫЙ/u);
  assert.match(result.telegram_preview.text, /ИСТОЧНИК/u);
  assert.deepEqual(result.evidence.evidence_checks, ['source_id', 'source_type', 'excerpt_literal', 'fact_literal', 'company', 'published_at']);
});

test('optional personalization falls back to the owner-approved universal opening after one bounded phrase retry', async () => {
  const stub = await createModelStub(root, 'synthetic-company');
  let phraseCalls = 0;
  let reservations = 0;
  const modelAdapter = {
    fact: (request) => stub.fact(request),
    async phrase(request) {
      phraseCalls += 1;
      const envelope = await stub.phrase(request);
      return {
        ...envelope,
        output: {
          ...envelope.output,
          personalization_phrase: 'Это первое предложение с проверяемой длиной и корректным русским текстом для безопасного теста. Это второе предложение делает вариант недопустимым.',
        },
      };
    },
  };
  const result = await analyzeDryRun({
    root,
    inputUrl: 'https://synthetic-company.example/',
    fetcher: await createFixtureFetcher(root, 'synthetic-company'),
    modelAdapter,
    offerProfile: await loadOfferProfile(root, 'fixtures/offer-profile.synthetic-eval.v1.yaml'),
    beforeModelCalls: async () => { reservations += 1; },
    personalizationMode: 'optional',
  });
  assert.equal(phraseCalls, 2);
  assert.equal(reservations, 1);
  assert.equal(result.analysis.personalization_mode, 'UNIVERSAL_FALLBACK');
  assert.match(result.analysis.fact, /Синтетика Лаб/u);
  assert.ok(result.analysis.warnings.includes('PERSONALIZATION_REASON_PHRASE_SENTENCE_COUNT'));
  assert.match(result.draft.body_text, /^Добрый день!\s+Я помогаю интеграторам Bitrix24/u);
  assert.match(result.telegram_preview.text, /ПЕРВЫЙ АБЗАЦ · УНИВЕРСАЛЬНЫЙ/u);
  assert.equal(result.evidence.model_call_count, 3);
});

test('safe local phrase repair appends only a missing terminal mark without another model call', async () => {
  const stub = await createModelStub(root, 'synthetic-company');
  let phraseCalls = 0;
  const modelAdapter = {
    fact: (request) => stub.fact(request),
    async phrase(request) {
      phraseCalls += 1;
      const envelope = await stub.phrase(request);
      return {
        ...envelope,
        output: {
          ...envelope.output,
          personalization_phrase: envelope.output.personalization_phrase.replace(/\.$/u, ''),
        },
      };
    },
  };
  const result = await analyzeDryRun({
    root,
    inputUrl: 'https://synthetic-company.example/',
    fetcher: await createFixtureFetcher(root, 'synthetic-company'),
    modelAdapter,
    offerProfile: await loadOfferProfile(root, 'fixtures/offer-profile.synthetic-eval.v1.yaml'),
  });
  assert.equal(phraseCalls, 1);
  assert.equal(result.analysis.personalization_mode, 'PERSONALIZED');
  assert.ok(result.analysis.warnings.includes('PHRASE_FORMAT_REPAIRED'));
  assert.match(result.analysis.personalization_phrase, /\.$/u);
  assert.equal(repairPhraseFormatting('«Короткая тестовая фраза»'), 'Короткая тестовая фраза.');
});

test('universal-only mode makes no model call and reserves no model budget', async () => {
  let calls = 0;
  let reservations = 0;
  const result = await analyzeDryRun({
    root,
    inputUrl: 'https://synthetic-company.example/',
    fetcher: await createFixtureFetcher(root, 'synthetic-company'),
    modelAdapter: { async fact() { calls += 1; }, async phrase() { calls += 1; } },
    offerProfile: await loadOfferProfile(root, 'fixtures/offer-profile.synthetic-eval.v1.yaml'),
    beforeModelCalls: async () => { reservations += 1; },
    personalizationMode: 'off',
  });
  assert.equal(calls, 0);
  assert.equal(reservations, 0);
  assert.equal(result.analysis.personalization_mode, 'UNIVERSAL_ONLY');
  assert.equal(result.analysis.fact, null);
  assert.equal(result.evidence.model_attempted, false);
});

test('retry reuses a previously verified fact, revalidates its evidence and calls only the phrase model', async () => {
  const stub = await createModelStub(root, 'synthetic-company');
  const acceptedFact = JSON.parse(await readFile(`${root}/fixtures/model-results/synthetic-company/fact.json`, 'utf8'));
  let factCalls = 0;
  let phraseCalls = 0;
  let reservations = 0;
  const result = await analyzeDryRun({
    root,
    inputUrl: 'https://synthetic-company.example/',
    fetcher: await createFixtureFetcher(root, 'synthetic-company'),
    modelAdapter: {
      async fact() {
        factCalls += 1;
        throw new Error('fact model must not be called for a verified resume fact');
      },
      async phrase(request) {
        phraseCalls += 1;
        return stub.phrase(request);
      },
    },
    offerProfile: await loadOfferProfile(root, 'fixtures/offer-profile.synthetic-eval.v1.yaml'),
    acceptedFact,
    beforeModelCalls: async () => { reservations += 1; },
  });
  assert.equal(result.status, 'DRAFT_READY');
  assert.equal(result.analysis.personalization_mode, 'PERSONALIZED');
  assert.equal(factCalls, 0);
  assert.equal(phraseCalls, 1);
  assert.equal(reservations, 1);
  assert.equal(result.evidence.fact_model.model, 'reused-verified-fact');
  assert.deepEqual(result.evidence.evidence_checks, ['source_id', 'source_type', 'excerpt_literal', 'fact_literal', 'company', 'published_at']);
});

test('pipeline removes an unsupported optional date and exposes the warning in review output', async () => {
  const stub = await createModelStub(root, 'synthetic-company');
  const modelAdapter = {
    async fact(request) {
      const envelope = await stub.fact(request);
      return { ...envelope, output: { ...envelope.output, published_at: '2026-07-22' } };
    },
    phrase(request) {
      return stub.phrase(request);
    },
  };
  const result = await analyzeDryRun({
    root,
    inputUrl: 'https://synthetic-company.example/',
    fetcher: await createFixtureFetcher(root, 'synthetic-company'),
    modelAdapter,
    offerProfile: await loadOfferProfile(root, 'fixtures/offer-profile.synthetic-eval.v1.yaml'),
    seed: 'integration-unconfirmed-date',
  });
  assert.equal(result.status, 'DRAFT_READY');
  assert.equal(result.analysis.published_at, null);
  assert.ok(result.analysis.warnings.includes('PUBLISHED_AT_UNCONFIRMED_REMOVED'));
  assert.match(result.telegram_preview.text, /PUBLISHED_AT_UNCONFIRMED_REMOVED/u);
  assert.equal(result.evidence.fact_prompt_version, 'fact-extraction.v2');
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

test('ambiguous published contacts stop before model budget reservation and expose sourced candidates', async () => {
  let modelCalls = 0;
  let reservations = 0;
  const fetcher = async (url) => {
    const parsed = new URL(url);
    if (parsed.pathname === '/robots.txt') return { url, contentType: 'text/plain', body: '', bytes: 0 };
    const body = '<html><head><title>Контакт Тест</title></head><body><a href="mailto:hr@contact-test.example">HR</a><a href="mailto:jobs@contact-test.example">Jobs</a></body></html>';
    return { url, contentType: 'text/html', body, bytes: Buffer.byteLength(body) };
  };
  const result = await analyzeDryRun({
    root,
    inputUrl: 'https://contact-test.example/',
    fetcher,
    modelAdapter: { async fact() { modelCalls += 1; }, async phrase() { modelCalls += 1; } },
    offerProfile: await loadOfferProfile(root),
    beforeModelCalls: async () => { reservations += 1; },
  });
  assert.equal(result.status, 'NEEDS_REVIEW');
  assert.equal(result.contact.candidates.length, 2);
  assert.ok(result.contact.candidates.every((candidate) => candidate.provenance === 'published' && candidate.source_url === 'https://contact-test.example/'));
  assert.equal(modelCalls, 0);
  assert.equal(reservations, 0);
});

test('explicit manual contact is labelled manual and remains outside model requests', async () => {
  const model = await createModelStub(root, 'synthetic-company');
  const result = await analyzeDryRun({
    root,
    inputUrl: 'https://synthetic-company.example/',
    fetcher: await createFixtureFetcher(root, 'synthetic-company'),
    modelAdapter: model,
    offerProfile: await loadOfferProfile(root, 'fixtures/offer-profile.synthetic-eval.v1.yaml'),
    contactSelection: { type: 'manual', email: ' Known.Contact@Example.com ' },
  });
  assert.equal(result.status, 'DRAFT_READY');
  assert.equal(result.contact.selected.email, 'known.contact@example.com');
  assert.equal(result.contact.selected.category, 'manual');
  assert.equal(result.contact.selected.provenance, 'manual');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { evidenceGate, businessGate } from '../../n8n/code/lib/gates.mjs';
import { loadTemplate, renderDraft } from '../../n8n/code/lib/templates.mjs';

const pages = [{ source_id: 'p01', source_type: 'about', source_url: 'https://acme.example/about', title: 'Acme', text: 'Компания Acme создала проверяемый учебный сервис.' }];

test('evidence requires literal source excerpt and literal fact', () => {
  const fact = { company_name: 'Acme', fact: 'Acme создала проверяемый учебный сервис.', source_id: 'p01', source_excerpt: 'Компания Acme создала проверяемый учебный сервис.', source_type: 'about', published_at: null, decision: 'READY_FOR_REVIEW' };
  assert.equal(evidenceGate(fact, pages, 'acme.example').accepted, true);
  assert.throws(() => evidenceGate({ ...fact, fact: 'Acme получила миллион клиентов.' }, pages, 'acme.example'), { code: 'EVIDENCE_FACT_NOT_LITERAL' });
});

test('evidence accepts an exact company name published in a loaded page title', () => {
  const titleOnlyPages = [{
    source_id: 'p01',
    source_type: 'homepage_or_other',
    source_url: 'https://mslab.kz/',
    title: 'Лаборатория управленческих решений',
    text: 'Мы повышаем управляемость и автоматизируем процессы компании.',
  }];
  const fact = {
    company_name: 'Лаборатория управленческих решений',
    fact: 'автоматизируем процессы компании',
    source_id: 'p01',
    source_excerpt: 'Мы повышаем управляемость и автоматизируем процессы компании.',
    source_type: 'homepage_or_other',
    published_at: null,
    decision: 'READY_FOR_REVIEW',
  };
  assert.equal(evidenceGate(fact, titleOnlyPages, 'mslab.kz').accepted, true);
});

test('evidence accepts a literal Latin brand token present in the submitted domain', () => {
  const fact = {
    company_name: 'MSLAB — Лаборатория управленческих решений',
    fact: 'автоматизируем процессы компании',
    source_id: 'p01',
    source_excerpt: 'Мы повышаем управляемость и автоматизируем процессы компании.',
    source_type: 'homepage_or_other',
    published_at: null,
    decision: 'READY_FOR_REVIEW',
  };
  const titleOnlyPages = [{
    source_id: 'p01',
    source_type: 'homepage_or_other',
    source_url: 'https://mslab.kz/',
    title: 'Лаборатория управленческих решений',
    text: 'Мы повышаем управляемость и автоматизируем процессы компании.',
  }];
  assert.equal(evidenceGate(fact, titleOnlyPages, 'mslab.kz').accepted, true);
  assert.throws(() => evidenceGate(fact, titleOnlyPages, 'unrelated.example'), { code: 'EVIDENCE_COMPANY_UNCONFIRMED' });
});

test('business gate recomputes word count and validates claim IDs', () => {
  const offer = { owner_approved: false, synthetic_eval: true, claims: [{ id: 'claim-1', text: 'Synthetic' }] };
  const phrase = {
    personalization_phrase: 'Ваш проверяемый учебный сервис хорошо пересекается с нашим синтетическим подходом к аккуратной повторяемой проверке материалов непосредственно перед их публичной публикацией.',
    offer_claim_ids: ['claim-1'], decision: 'READY_FOR_REVIEW',
  };
  assert.equal(businessGate(phrase, offer).accepted, true);
  assert.throws(() => businessGate({ ...phrase, offer_claim_ids: ['unknown'] }, offer), { code: 'OFFER_CLAIM_UNKNOWN' });
});

test('template escapes HTML values and is owner-approved for guarded sending', async () => {
  const root = new URL('../../', import.meta.url).pathname.replace(/^\/(?:[A-Za-z]:)/u, (match) => match.slice(1));
  const template = await loadTemplate(decodeURIComponent(root));
  const draft = renderDraft(template, { PERSONALIZATION_PHRASE: '<b>безопасная фраза</b>', COMPANY_NAME: 'A&B' });
  assert.match(draft.body_html, /&lt;b&gt;безопасная фраза&lt;\/b&gt;/u);
  assert.equal(draft.sendable, true);
  assert.deepEqual(template.manifest.allowed_placeholders, ['COMPANY_NAME', 'PERSONALIZATION_PHRASE']);
  assert.match(draft.body_text, /Если такие обращения для вашей компании неактуальны/u);
});

test('business gate enforces one sentence, one claim and a hard maximum of 40 words', () => {
  const offer = { owner_approved: true, claims: [{ id: 'claim-1', text: 'Approved' }, { id: 'claim-2', text: 'Approved' }] };
  const base = {
    personalization_phrase: 'Опубликованный вами кейс внедрения CRM пересекается с моим опытом обследования процессов, проектирования решений и сопровождения реализации сложных интеграционных проектов на базе Bitrix24 для команд интеграторов.',
    offer_claim_ids: ['claim-1'], decision: 'READY_FOR_REVIEW',
  };
  assert.equal(businessGate(base, offer).accepted, true);
  assert.throws(() => businessGate({ ...base, offer_claim_ids: ['claim-1', 'claim-2'] }, offer), { code: 'OFFER_CLAIM_COUNT' });
  assert.throws(() => businessGate({ ...base, personalization_phrase: `${base.personalization_phrase} Ещё одно предложение.` }, offer), { code: 'PHRASE_SENTENCE_COUNT' });
  assert.throws(() => businessGate({
    ...base,
    personalization_phrase: 'Ваше внедрение и сопровождение CRM под ключ напрямую пересекается с моим опытом полного аналитического цикла, проектирования решений, запуска, поддержки и совместной работы с командами интеграторов Bitrix24.',
  }, offer), { code: 'PHRASE_GRAMMAR_AGREEMENT' });
});

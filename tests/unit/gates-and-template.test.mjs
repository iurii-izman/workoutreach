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

test('evidence preserves only a publication date literally present in the selected excerpt', () => {
  const datedPages = [{ ...pages[0], text: '2026-07-22 Компания Acme создала проверяемый учебный сервис.' }];
  const fact = {
    company_name: 'Acme',
    fact: 'Acme создала проверяемый учебный сервис.',
    source_id: 'p01',
    source_excerpt: '2026-07-22 Компания Acme создала проверяемый учебный сервис.',
    source_type: 'about',
    published_at: '2026-07-22',
    decision: 'READY_FOR_REVIEW',
  };
  const accepted = evidenceGate(fact, datedPages, 'acme.example');
  assert.equal(accepted.publishedAt, '2026-07-22');
  assert.deepEqual(accepted.warnings, []);
});

test('evidence removes an unsupported optional publication date without weakening mandatory gates', () => {
  const fact = {
    company_name: 'Acme',
    fact: 'Acme создала проверяемый учебный сервис.',
    source_id: 'p01',
    source_excerpt: 'Компания Acme создала проверяемый учебный сервис.',
    source_type: 'about',
    published_at: '2026-07-22',
    decision: 'READY_FOR_REVIEW',
  };
  const accepted = evidenceGate(fact, pages, 'acme.example');
  assert.equal(accepted.publishedAt, null);
  assert.deepEqual(accepted.warnings, ['PUBLISHED_AT_UNCONFIRMED_REMOVED']);
  assert.throws(() => evidenceGate({ ...fact, fact: 'Неподтверждённый факт.' }, pages, 'acme.example'), { code: 'EVIDENCE_FACT_NOT_LITERAL' });
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
    personalization_phrase: 'Вижу, что ваш учебный сервис помогает проверять публичные тексты до публикации. Мне близки такие проекты, где особенно важны системность, точность требований и воспроизводимость проверки материалов.',
    offer_claim_ids: ['claim-1'], decision: 'READY_FOR_REVIEW',
  };
  assert.equal(businessGate(phrase, offer).accepted, true);
  assert.throws(() => businessGate({ ...phrase, offer_claim_ids: ['unknown'] }, offer), { code: 'OFFER_CLAIM_UNKNOWN' });
});

test('active template is the exact owner-approved universal letter with no dynamic placeholders', async () => {
  const root = new URL('../../', import.meta.url).pathname.replace(/^\/(?:[A-Za-z]:)/u, (match) => match.slice(1));
  const template = await loadTemplate(decodeURIComponent(root));
  const draft = renderDraft(template, {});
  assert.equal(draft.sendable, true);
  assert.equal(template.manifest.version, 'email-ru-career-v3');
  assert.deepEqual(template.manifest.allowed_placeholders, []);
  assert.equal(draft.subject, 'Системный аналитик Bitrix24 — сотрудничество');
  assert.match(draft.body_text, /^Добрый день!\s+Я системный и бизнес-аналитик с 6\+ годами/u);
  assert.match(draft.body_text, /Подскажите, может ли мой опыт быть полезен вашей команде сейчас или в ближайших проектах\?/u);
  assert.doesNotMatch(draft.body_text, /\{\{|Казахстан|ПЕРСОНАЛЬНАЯ/u);
  assert.doesNotMatch(draft.body_html, /\{\{|Казахстан|ПЕРСОНАЛЬНАЯ/u);
  assert.doesNotMatch(draft.body_text, /Если такие обращения|больше не буду писать/u);
  assert.doesNotMatch(draft.body_html, /Если такие обращения|больше не буду писать/u);
  assert.throws(() => renderDraft(template, { OPENING_PARAGRAPH: 'нельзя' }), { code: 'TEMPLATE_VALUE_UNKNOWN' });
});

test('frozen v2 template still escapes its historical eval-only opening value', async () => {
  const root = new URL('../../', import.meta.url).pathname.replace(/^\/(?:[A-Za-z]:)/u, (match) => match.slice(1));
  const template = await loadTemplate(decodeURIComponent(root), 'v2');
  const draft = renderDraft(template, { OPENING_PARAGRAPH: '<b>безопасная фраза</b>' });
  assert.match(draft.body_html, /&lt;b&gt;безопасная фраза&lt;\/b&gt;/u);
});

test('business gate enforces the two-sentence bridge, one claim and a hard maximum of 35 words', () => {
  const offer = { owner_approved: true, claims: [{ id: 'claim-1', text: 'Approved' }, { id: 'claim-2', text: 'Approved' }] };
  const base = {
    personalization_phrase: 'Опубликованный вами кейс показывает комплексность внедрения CRM и интеграций. Мне близки такие проекты, где особенно важны точные требования, связность решений и управляемое движение команды к результату.',
    offer_claim_ids: ['claim-1'], decision: 'READY_FOR_REVIEW',
  };
  assert.equal(businessGate(base, offer).accepted, true);
  assert.throws(() => businessGate({ ...base, offer_claim_ids: ['claim-1', 'claim-2'] }, offer), { code: 'OFFER_CLAIM_COUNT' });
  assert.throws(() => businessGate({ ...base, personalization_phrase: `${base.personalization_phrase} Ещё одно предложение. И третье.` }, offer), { code: 'PHRASE_SENTENCE_COUNT' });
  assert.throws(() => businessGate({
    ...base,
    personalization_phrase: 'Ваше внедрение и сопровождение CRM под ключ напрямую пересекается с потребностью в системной аналитике. Мне близки такие проекты, где важны точные требования и согласованная работа команды.',
  }, offer), { code: 'PHRASE_GRAMMAR_AGREEMENT' });
  assert.throws(() => businessGate({
    ...base,
    personalization_phrase: 'Учитывая внедрение Bitrix24 и интеграцию CRM с 1С, ваш полный аналитический цикл от обследования процессов до сопровождения запуска выглядит особенно ценным для подобных комплексных проектов.',
  }, offer), { code: 'PHRASE_PERSPECTIVE' });
  assert.throws(() => businessGate({
    ...base,
    personalization_phrase: 'Вижу опубликованный кейс внедрения Bitrix24 и интеграции с 1С — моему опыту аналитики и сопровождения сложных CRM-проектов этот профиль кажется особенно релевантным.',
  }, offer), { code: 'PHRASE_VAGUE_CONNECTION' });
  assert.throws(() => businessGate({
    ...base,
    personalization_phrase: 'LIGASOFT внедряет Bitrix24 и связывает CRM с 1С и интернет-магазинами; мне близки такие задачи: мой опыт интеграций помогает предметно работать с разработчиками.',
  }, offer), { code: 'PHRASE_PERSPECTIVE' });
  assert.throws(() => businessGate({
    ...base,
    personalization_phrase: 'LIGASOFT внедряет Bitrix24 и связывает CRM с 1С и интернет-магазинами; мне близки комплексные задачи: особенно важны точные требования и связность решений.',
  }, offer), { code: 'PHRASE_STYLE' });
  assert.throws(() => businessGate({
    ...base,
    personalization_phrase: 'Вижу, что у вас внедрён Bitrix24 для автоматизации оптовых продаж металлопроката в Казахстане. Мне близки такие проекты, где CRM-интеграции требуют точных требований и связности решений.',
  }, offer, { acceptedFact: 'Кейс внедрения Bitrix24 для автоматизации оптовых продаж металлопроката.' }), { code: 'PHRASE_FACT_PERSPECTIVE' });
  assert.throws(() => businessGate({
    ...base,
    personalization_phrase: 'Ваш кейс внедрения Bitrix24 для автоматизации продаж показывает комплексность проекта. Мне близки такие задачи, где помогает накопленный за более чем шесть лет опыт работы с CRM и интеграциями.',
  }, offer, { acceptedFact: 'Кейс внедрения Bitrix24 для автоматизации оптовых продаж металлопроката.' }), { code: 'PHRASE_TEMPLATE_REPETITION' });
  assert.throws(() => businessGate({
    ...base,
    personalization_phrase: 'LIGASOFT внедряет Bitrix24 и 1С для автоматизации процессов. Мне близки такие проекты, где обследование процессов и проектирование интеграций помогают согласовать изменения.',
  }, offer), { code: 'PHRASE_TEMPLATE_REPETITION' });
  assert.throws(() => businessGate({
    ...base,
    personalization_phrase: 'Ваш кейс внедрения Битрикс24 описывает комплексный CRM-проект. Мне близки такие проекты, где проектирование CRM-решений и интеграций помогает связать процессы компании и работу команды.',
  }, offer), { code: 'PHRASE_TEMPLATE_REPETITION' });
  assert.throws(() => businessGate({
    ...base,
    personalization_phrase: 'Ваш кейс внедрения Битрикс24 для автоматизации оптовых продаж металлопроката. Мне близки такие проекты, где CRM связывает процессы продаж и данные, сохраняя управляемость изменений.',
  }, offer), { code: 'PHRASE_SENTENCE_FRAGMENT' });
});

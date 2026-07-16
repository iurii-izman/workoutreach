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

test('business gate recomputes word count and validates claim IDs', () => {
  const offer = { owner_approved: false, synthetic_eval: true, claims: [{ id: 'claim-1', text: 'Synthetic' }] };
  const phrase = {
    personalization_phrase: 'Ваш проверяемый учебный сервис хорошо пересекается с нашим синтетическим подходом к аккуратной повторяемой проверке материалов непосредственно перед их публичной публикацией.',
    offer_claim_ids: ['claim-1'], decision: 'READY_FOR_REVIEW',
  };
  assert.equal(businessGate(phrase, offer).accepted, true);
  assert.throws(() => businessGate({ ...phrase, offer_claim_ids: ['unknown'] }, offer), { code: 'OFFER_CLAIM_UNKNOWN' });
});

test('template escapes HTML values and remains non-sendable', async () => {
  const root = new URL('../../', import.meta.url).pathname.replace(/^\/(?:[A-Za-z]:)/u, (match) => match.slice(1));
  const template = await loadTemplate(decodeURIComponent(root));
  const draft = renderDraft(template, { PERSONALIZATION_PHRASE: '<b>безопасная фраза</b>', COMPANY_NAME: 'A&B', SENDER_NAME: 'Owner', OPT_OUT_TEXT: 'stop' });
  assert.match(draft.body_html, /&lt;b&gt;безопасная фраза&lt;\/b&gt;/u);
  assert.equal(draft.sendable, false);
});

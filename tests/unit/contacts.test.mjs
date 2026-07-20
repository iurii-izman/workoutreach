import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseContact, choosePhone, classifyEmail, extractContactsFromHtml, extractPhonesFromHtml } from '../../n8n/code/lib/contacts.mjs';

const page = { source_id: 'p01', source_url: 'https://example.com/contacts' };

test('extracts only published mailto and visible addresses with provenance', () => {
  const contacts = extractContactsFromHtml('<body>Write to info@example.com <a href="mailto:sales@example.com">sales</a></body>', page);
  assert.deepEqual(contacts.map((item) => item.email).sort(), ['info@example.com', 'sales@example.com']);
  assert.ok(contacts.every((item) => item.source_id === 'p01' && item.source_excerpt));
});

test('classifies protected-purpose mailboxes and refuses automatic selection', () => {
  assert.equal(classifyEmail('jobs@example.com'), 'recruiting');
  assert.equal(classifyEmail('support@example.com'), 'support');
  assert.equal(classifyEmail('privacy@example.com'), 'privacy_or_legal');
  assert.equal(classifyEmail('noreply@example.com'), 'system_or_automated');
  const candidate = extractContactsFromHtml('<body>jobs@example.com</body>', page);
  assert.equal(chooseContact(candidate).decision, 'NEEDS_CONTACT');
});

test('career outreach accepts one explicitly published personal business contact for human review', () => {
  const candidates = extractContactsFromHtml('<body>Пишите galimov@business.example</body>', page);
  const result = chooseContact(candidates, { campaignType: 'career_outreach' });
  assert.equal(result.decision, 'SELECTED_FOR_REVIEW');
  assert.equal(result.selected.email, 'galimov@business.example');
  assert.equal(result.selected.category, 'personal_named');
});

test('malformed mailto values are not persisted as email candidates', () => {
  const candidates = extractContactsFromHtml('<body><a href="mailto:tel:+79601907040">call</a></body>', page);
  assert.deepEqual(candidates, []);
});

test('requires a human when more than one eligible address exists', () => {
  const candidates = extractContactsFromHtml('<body>info@example.com sales@example.com</body>', page);
  assert.equal(chooseContact(candidates).decision, 'NEEDS_REVIEW');
});

test('career outreach prefers one recruiting address over a general mailbox', () => {
  const candidates = extractContactsFromHtml('<body>hr@example.com info@example.com sales@example.com</body>', page);
  const result = chooseContact(candidates, { campaignType: 'career_outreach' });
  assert.equal(result.decision, 'SELECTED_FOR_REVIEW');
  assert.equal(result.selected.email, 'hr@example.com');
  assert.equal(result.candidates.find((item) => item.email === 'sales@example.com').automatic_selection_allowed, false);
});

test('career outreach requires review for multiple equally preferred recruiting addresses', () => {
  const candidates = extractContactsFromHtml('<body>hr@example.com careers@example.com info@example.com</body>', page);
  assert.equal(chooseContact(candidates, { campaignType: 'career_outreach' }).decision, 'NEEDS_REVIEW');
});

test('extracts published phones without inference and prefers the contact page', () => {
  const about = { ...page, source_type: 'about' };
  const contact = { ...page, source_id: 'p02', source_url: 'https://example.com/contacts', source_type: 'contact' };
  const candidates = [
    ...extractPhonesFromHtml('<body>Офис +7 (777) 111-22-33</body>', about),
    ...extractPhonesFromHtml('<body><a href="tel:+77779432255">Позвонить</a></body>', contact),
  ];
  const result = choosePhone(candidates);
  assert.equal(result.selected.normalized_phone, '+77779432255');
  assert.equal(result.selected.source_id, 'p02');
});

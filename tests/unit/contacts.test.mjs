import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseContact, classifyEmail, extractContactsFromHtml } from '../../n8n/code/lib/contacts.mjs';

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
  const candidate = extractContactsFromHtml('<body>jobs@example.com</body>', page);
  assert.equal(chooseContact(candidate).decision, 'NEEDS_CONTACT');
});

test('requires a human when more than one eligible address exists', () => {
  const candidates = extractContactsFromHtml('<body>info@example.com sales@example.com</body>', page);
  assert.equal(chooseContact(candidates).decision, 'NEEDS_REVIEW');
});

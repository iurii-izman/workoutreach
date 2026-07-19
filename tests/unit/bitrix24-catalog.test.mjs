import test from 'node:test';
import assert from 'node:assert/strict';
import { extractCatalogPartners, extractPublishedPartnerWebsite, validateCatalogBatch } from '../../n8n/code/lib/bitrix24-catalog.mjs';

test('vendor catalog extraction accepts only canonical Kazakhstan partner profiles', () => {
  const html = `<a href="/partners/partner/123/">Synthetic Partner</a><a href="https://evil.example/partners/partner/999/">Ignore</a><a href="/partners/partner/123/?x=1">Duplicate</a>`;
  assert.deepEqual(extractCatalogPartners(html), [{ partner_id: '123', company_name: 'Synthetic Partner', profile_url: 'https://www.bitrix24.kz/partners/partner/123/' }]);
});

test('profile extraction accepts one explicitly displayed company domain and ignores platform links', () => {
  const html = `<a href="https://helpdesk.bitrix24.ru/">Support</a><a href="https://synthetic-integrator.example/about">synthetic-integrator.example</a>`;
  assert.equal(extractPublishedPartnerWebsite(html, 'https://www.bitrix24.kz/partners/partner/123/'), 'https://synthetic-integrator.example/');
});

test('profile extraction refuses ambiguity and catalog staging has a hard review bound', () => {
  const html = `<a href="https://one.example/">one.example</a><a href="https://two.example/">two.example</a>`;
  assert.equal(extractPublishedPartnerWebsite(html, 'https://www.bitrix24.kz/partners/partner/123/'), null);
  assert.throws(() => validateCatalogBatch(Array.from({ length: 26 }, (_, index) => ({ partner_id: String(index) }))), { code: 'CATALOG_REVIEW_LIMIT' });
});

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractCatalogPartners, extractPublishedPartnerWebsite, validateCatalogBatch } from '../n8n/code/lib/bitrix24-catalog.mjs';
import { parseRobots } from '../n8n/code/lib/crawl.mjs';
import { asSafeResult, SafeStop } from '../n8n/code/lib/errors.mjs';
import { safeFetch } from '../n8n/code/lib/safe-fetch.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const catalogUrl = 'https://www.bitrix24.kz/partners/';
const artifactDirectory = join(root, 'artifacts', 'catalog');

try {
  const robotsResponse = await safeFetch('https://www.bitrix24.kz/robots.txt', { accept: 'text/plain' });
  const robots = parseRobots(robotsResponse.body);
  if (!robots.allows(catalogUrl)) throw new SafeStop('ROBOTS_BLOCKED', 'Vendor robots policy blocks the partner catalog');

  const catalogResponse = await safeFetch(catalogUrl);
  const partners = validateCatalogBatch(extractCatalogPartners(catalogResponse.body, catalogResponse.url));
  const staged = [];
  for (const partner of partners) {
    if (!robots.allows(partner.profile_url)) throw new SafeStop('ROBOTS_BLOCKED', 'Vendor robots policy blocks a partner profile');
    const profile = await safeFetch(partner.profile_url);
    staged.push({ ...partner, company_website_url: extractPublishedPartnerWebsite(profile.body, profile.url), review_status: 'REVIEW_REQUIRED' });
  }

  const snapshot = {
    schema_version: 'bitrix24-kz-catalog-stage.v1',
    generated_at: new Date().toISOString(),
    source_url: catalogUrl,
    source_kind: 'vendor_catalog_seed_only',
    transmission_authorized: false,
    openai_calls: 0,
    partner_count: staged.length,
    website_count: staged.filter((item) => item.company_website_url).length,
    partners: staged,
  };
  await mkdir(artifactDirectory, { recursive: true });
  const path = join(artifactDirectory, 'bitrix24-kz-latest.json');
  await writeFile(path, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ ok: true, artifact: 'artifacts/catalog/bitrix24-kz-latest.json', partner_count: snapshot.partner_count, website_count: snapshot.website_count, openai_calls: 0, email_sent: false, review_required: true }));
} catch (error) {
  console.error(JSON.stringify(asSafeResult(error)));
  process.exit(1);
}

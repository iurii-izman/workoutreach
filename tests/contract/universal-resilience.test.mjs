import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = decodeURIComponent(new URL('../../', import.meta.url).pathname.replace(/^\/(?:[A-Za-z]:)/u, (match) => match.slice(1)));
const migration = await readFile(`${root}/migrations/012_universal_first_resilience.sql`, 'utf8');
const compose = await readFile(`${root}/compose.local.yaml`, 'utf8');
const template = JSON.parse(await readFile(`${root}/templates/email/ru/v2/manifest.json`, 'utf8'));

test('resilience migration allows bounded operator retry and at most three model calls', () => {
  assert.match(migration, /VALUES \('FAILED','ANALYZING'\)/u);
  assert.match(migration, /reserved_calls BETWEEN 1 AND 3/u);
  assert.match(migration, /012_universal_first_resilience/u);
});

test('production defaults use optional personalization on the cost-sensitive Luna role', () => {
  assert.match(compose, /OPENAI_MODEL: \$\{OPENAI_MODEL:-gpt-5\.6-luna\}/u);
  assert.match(compose, /OUTREACH_PERSONALIZATION_MODE: \$\{OUTREACH_PERSONALIZATION_MODE:-optional\}/u);
});

test('owner-approved v2 template exposes only one reviewed opening paragraph', () => {
  assert.equal(template.sendable, true);
  assert.equal(template.owner_approved, true);
  assert.deepEqual(template.allowed_placeholders, ['OPENING_PARAGRAPH']);
  assert.equal(template.required_placeholders[0], 'OPENING_PARAGRAPH');
  assert.equal(template.universal_opening, 'Я помогаю интеграторам Bitrix24 превращать неструктурированные запросы клиентов в понятные требования и реализуемые CRM-решения — от обследования процессов и проектирования интеграций до запуска и сопровождения.');
});

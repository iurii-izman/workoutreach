import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = decodeURIComponent(new URL('../../', import.meta.url).pathname.replace(/^\/(?:[A-Za-z]:)/u, (match) => match.slice(1)));
const migration = await readFile(`${root}/migrations/012_universal_first_resilience.sql`, 'utf8');
const compose = await readFile(`${root}/compose.local.yaml`, 'utf8');
const template = JSON.parse(await readFile(`${root}/templates/email/ru/v3/manifest.json`, 'utf8'));

test('resilience migration allows bounded operator retry and at most three model calls', () => {
  assert.match(migration, /VALUES \('FAILED','ANALYZING'\)/u);
  assert.match(migration, /reserved_calls BETWEEN 1 AND 3/u);
  assert.match(migration, /012_universal_first_resilience/u);
});

test('production bot is fixed to universal-only and receives no OpenAI secret', () => {
  assert.match(compose, /OUTREACH_PERSONALIZATION_MODE: "off"/u);
  assert.doesNotMatch(compose, /OPENAI_MODEL:|openai_api_key/u);
});

test('owner-approved v3 template is fixed and exposes no dynamic placeholder', () => {
  assert.equal(template.sendable, true);
  assert.equal(template.owner_approved, true);
  assert.equal(template.content_policy, 'fixed_universal_no_placeholders');
  assert.deepEqual(template.allowed_placeholders, []);
  assert.deepEqual(template.required_placeholders, []);
  assert.match(template.universal_opening, /^Я системный и бизнес-аналитик/u);
});

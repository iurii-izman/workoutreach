import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const migration = await readFile(resolve(root, 'migrations/003_stage_2_mock_outbox.sql'), 'utf8');

test('stage-2 migration contains atomic approval and replay boundaries', () => {
  for (const contract of [
    'CREATE TABLE IF NOT EXISTS approval_tokens',
    'CREATE TABLE IF NOT EXISTS suppression',
    'CREATE TABLE IF NOT EXISTS operator_actions',
    'CREATE TABLE IF NOT EXISTS outbox',
    'CREATE OR REPLACE FUNCTION handle_mock_send_callback',
    'FOR UPDATE',
    'UNIQUE (job_id, draft_version)',
    "transport = 'mock'",
  ]) assert.match(migration, new RegExp(contract.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));
});

test('stage-2 database is physically unable to represent live sending', () => {
  assert.match(migration, /live_send_enabled = false/u);
  assert.match(migration, /mail_transport = 'disabled'/u);
  assert.match(migration, /daily_send_limit = 0/u);
  assert.match(migration, /kill_switch_enabled = true/u);
  assert.match(migration, /CHECK \(provider_message_id IS NULL\)/u);
  assert.doesNotMatch(migration, /smtp|sendgrid|mailgun|resend\.com|graph\.microsoft|gmail\.googleapis/iu);
});

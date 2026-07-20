import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migration = await readFile(new URL('../../migrations/008_local_operator_dashboard.sql', import.meta.url), 'utf8');
const compose = await readFile(new URL('../../compose.yaml', import.meta.url), 'utf8');
const client = await readFile(new URL('../../dashboard/public/app.js', import.meta.url), 'utf8');
const localStatus = await readFile(new URL('../../scripts/local-stage2-status.mjs', import.meta.url), 'utf8');

test('dashboard migration keeps delivery and engagement state separate', () => {
  assert.match(migration, /transport = 'smtp' AND o\.status = 'SMTP_ACCEPTED'/u);
  assert.match(migration, /'MOCK_PENDING', 'MOCK_CLAIMED', 'MOCK_ACCEPTED'/u);
  assert.match(migration, /SENT_WAITING_SYSTEM_MANAGED/u);
  assert.match(migration, /outbox_company_do_not_contact/u);
  assert.match(migration, /SECURITY DEFINER[\s\S]+SET search_path = workoutreach, pg_catalog/u);
  assert.match(migration, /REVOKE ALL ON ALL TABLES IN SCHEMA workoutreach FROM workoutreach_dashboard/u);
  assert.match(migration, /COMPANY_STATUS_HISTORY_IMMUTABLE/u);
});

test('dashboard container is internal, read-only and has no send credentials', () => {
  const service = compose.slice(compose.indexOf('  workoutreach-dashboard:\n'), compose.indexOf('\n  workoutreach-bot-smoke:'));
  assert.match(service, /read_only: true/u);
  assert.match(service, /no-new-privileges:true/u);
  assert.match(service, /cap_drop:\n\s+- ALL/u);
  assert.doesNotMatch(service, /ports:/u);
  assert.doesNotMatch(service, /workoutreach_egress/u);
  assert.doesNotMatch(service, /telegram|openai|smtp|suppression_hmac/iu);
});

test('database values are never rendered through innerHTML', () => {
  assert.doesNotMatch(client, /innerHTML|insertAdjacentHTML|outerHTML/u);
  assert.match(client, /textContent/u);
});

test('local status requires every runtime service and pilot migration', () => {
  for (const service of ['workoutreach-postgres', 'workoutreach-n8n', 'workoutreach-proxy', 'workoutreach-dashboard', 'workoutreach-bot']) {
    assert.match(localStatus, new RegExp(`containers\\['${service}'\\]\\.health === 'healthy'`, 'u'));
  }
  for (const version of ['004', '005', '006', '007', '008', '009', '010', '011']) {
    assert.match(localStatus, new RegExp(`database\\.migration_${version} === true`, 'u'));
  }
});

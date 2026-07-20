import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = decodeURIComponent(new URL('../../', import.meta.url).pathname.replace(/^\/(?:[A-Za-z]:)/u, (match) => match.slice(1)));
const migration = await readFile(`${root}/migrations/009_owner_daily_capacity.sql`, 'utf8');

test('owner-approved capacity remains finite and database-enforced', () => {
  assert.match(migration, /daily_send_limit BETWEEN 0 AND 30/u);
  assert.match(migration, /p_daily_limit NOT BETWEEN 1 AND 30/u);
  assert.match(migration, /p_daily_analysis_limit NOT BETWEEN 1 AND 40/u);
  assert.match(migration, /pg_advisory_xact_lock/u);
});

test('owner-capacity migration can replace its named runtime constraints', () => {
  assert.match(migration, /DROP CONSTRAINT IF EXISTS mail_runtime_controls_daily_send_limit_check/u);
  assert.match(migration, /DROP CONSTRAINT IF EXISTS mail_runtime_controls_state_check/u);
});

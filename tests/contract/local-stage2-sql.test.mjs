import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const migration = await readFile(resolve(root, 'migrations/004_local_stage_2_runtime.sql'), 'utf8');
const budgetMigration = await readFile(resolve(root, 'migrations/005_local_model_budget.sql'), 'utf8');
const localCompose = await readFile(resolve(root, 'compose.local.yaml'), 'utf8');

test('local review callbacks use hashed one-time tokens and bounded regeneration', () => {
  assert.match(migration, /issue_local_review_token/u);
  assert.match(migration, /handle_local_review_action/u);
  assert.match(migration, /digest\(convert_to\(v_nonce, 'UTF8'\), 'sha256'\)/u);
  assert.match(migration, /v_draft\.draft_version >= 3/u);
  assert.match(migration, /FOR UPDATE/u);
  assert.match(migration, /FUNCTION assert_job_status_transition[\s\S]*SET search_path = workoutreach, public/u);
});

test('local OpenAI use is guarded by an atomic daily analysis budget', () => {
  assert.match(budgetMigration, /CREATE TABLE IF NOT EXISTS model_runs/u);
  assert.match(budgetMigration, /pg_advisory_xact_lock/u);
  assert.match(budgetMigration, /p_daily_analysis_limit NOT BETWEEN 1 AND 20/u);
  assert.match(localCompose, /DAILY_ANALYSIS_LIMIT: \$\{DAILY_ANALYSIS_LIMIT:-2\}/u);
  assert.match(localCompose, /LOCAL_OPENAI_MAX_OUTPUT_TOKENS:-1200/u);
});

test('local bot has no public port and retains the physical mail block', () => {
  assert.doesNotMatch(localCompose, /^\s+ports:/mu);
  assert.match(localCompose, /MAIL_TRANSPORT: disabled/u);
  assert.match(localCompose, /LIVE_SEND_ENABLED: "false"/u);
  assert.match(localCompose, /DAILY_SEND_LIMIT: "0"/u);
  assert.match(localCompose, /cap_drop:\s*\n\s+- ALL/u);
});

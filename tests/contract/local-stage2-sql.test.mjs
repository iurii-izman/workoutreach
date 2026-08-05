import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const migration = await readFile(resolve(root, 'migrations/004_local_stage_2_runtime.sql'), 'utf8');
const budgetMigration = await readFile(resolve(root, 'migrations/005_local_model_budget.sql'), 'utf8');
const smtpMigration = await readFile(resolve(root, 'migrations/006_guarded_smtp_delivery.sql'), 'utf8');
const sendabilityMigration = await readFile(resolve(root, 'migrations/007_stage_3_template_sendability.sql'), 'utf8');
const localCompose = await readFile(resolve(root, 'compose.local.yaml'), 'utf8');

test('local review callbacks use hashed one-time tokens and bounded regeneration', () => {
  assert.match(migration, /issue_local_review_token/u);
  assert.match(migration, /handle_local_review_action/u);
  assert.match(migration, /digest\(convert_to\(v_nonce, 'UTF8'\), 'sha256'\)/u);
  assert.match(migration, /v_draft\.draft_version >= 3/u);
  assert.match(migration, /FOR UPDATE/u);
  assert.match(migration, /FUNCTION assert_job_status_transition[\s\S]*SET search_path = workoutreach, public/u);
});

test('historical model budget remains guarded while the active bot exposes no OpenAI runtime', () => {
  assert.match(budgetMigration, /CREATE TABLE IF NOT EXISTS model_runs/u);
  assert.match(budgetMigration, /pg_advisory_xact_lock/u);
  assert.match(budgetMigration, /p_daily_analysis_limit NOT BETWEEN 1 AND 20/u);
  assert.match(localCompose, /DAILY_ANALYSIS_LIMIT: \$\{DAILY_ANALYSIS_LIMIT:-40\}/u);
  assert.match(localCompose, /OUTREACH_PERSONALIZATION_MODE: "off"/u);
  assert.doesNotMatch(localCompose, /OPENAI_(?:MODE|MODEL|API_KEY|MAX_OUTPUT_TOKENS)|openai_api_key/u);
});

test('local bot has no public port and guarded SMTP stays disabled by default', () => {
  assert.doesNotMatch(localCompose, /^\s+ports:/mu);
  assert.match(localCompose, /MAIL_TRANSPORT: \$\{MAIL_TRANSPORT:-disabled\}/u);
  assert.match(localCompose, /LIVE_SEND_ENABLED: \$\{LIVE_SEND_ENABLED:-false\}/u);
  assert.match(smtpMigration, /handle_smtp_send_callback/u);
  assert.match(smtpMigration, /claim_next_smtp_outbox/u);
  assert.match(smtpMigration, /p_daily_limit NOT BETWEEN 1 AND 5/u);
  assert.match(smtpMigration, /pg_advisory_xact_lock/u);
  assert.match(sendabilityMigration, /v_draft\.sendable<>true/u);
  assert.match(sendabilityMigration, /d\.sendable=true/u);
  assert.match(localCompose, /cap_drop:\s*\n\s+- ALL/u);
});

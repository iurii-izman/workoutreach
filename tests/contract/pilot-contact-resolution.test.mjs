import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = decodeURIComponent(new URL('../../', import.meta.url).pathname.replace(/^\/(?:[A-Za-z]:)/u, (match) => match.slice(1)));
const migration = await readFile(`${root}/migrations/011_pilot_contact_resolution.sql`, 'utf8');
const bot = await readFile(`${root}/n8n/code/lib/telegram-bot.mjs`, 'utf8');
const store = await readFile(`${root}/n8n/code/lib/postgres-store.mjs`, 'utf8');
const stage = JSON.parse(await readFile(`${root}/config/stage.json`, 'utf8'));

test('contact resolution migration distinguishes manual provenance and hashed review tokens', () => {
  assert.match(migration, /provenance IN \('published', 'manual'\)/u);
  assert.match(migration, /category = 'manual'/u);
  assert.match(migration, /nonce_sha256 char\(64\)/u);
  assert.match(migration, /contact_review_tokens_one_active_job/u);
});

test('Telegram contact callbacks carry candidate IDs rather than email addresses', () => {
  assert.match(store, /`contact:\$\{result\.job_id\}:\$\{candidate\.id\}:\$\{nonce\}`/u);
  assert.doesNotMatch(bot, /callback_data:\s*candidate\.email/u);
  assert.match(bot, /\/email WO-XXXXXX name@example\.com/u);
});

test('capability manifest distinguishes implemented SMTP from the disabled repository default', () => {
  assert.deepEqual(stage.implemented_stages, [0, 1, 2, 3]);
  assert.deepEqual(stage.repository_default, { mail_transport: 'disabled', live_send_enabled: false, live_outbox_enabled: false });
  assert.equal(stage.stage3_smtp_foundation.adapter_implemented, true);
  assert.equal(stage.stage3_smtp_foundation.smtp_outbox_implemented, true);
  assert.equal(stage.stage3_smtp_foundation.repository_default_active, false);
});

\set ON_ERROR_STOP on
SET search_path TO workoutreach, public;

DELETE FROM message_events WHERE job_id IN ('WO-STG201', 'WO-STG202', 'WO-STG203');
DELETE FROM outbox WHERE job_id IN ('WO-STG201', 'WO-STG202', 'WO-STG203');
DELETE FROM operator_actions WHERE job_id IN ('WO-STG201', 'WO-STG202', 'WO-STG203');
DELETE FROM jobs WHERE job_id IN ('WO-STG201', 'WO-STG202', 'WO-STG203');
DELETE FROM suppression WHERE recipient_hmac IN (repeat('b', 64)::char(64), repeat('c', 64)::char(64));

INSERT INTO jobs(
  job_id, canonical_url, hostname, telegram_user_id, telegram_chat_id, status, expires_at
) VALUES
  ('WO-STG201', 'https://stage2-one.example/', 'stage2-one.example', 101, 202, 'DRAFT_READY', CURRENT_TIMESTAMP + interval '24 hours'),
  ('WO-STG202', 'https://stage2-two.example/', 'stage2-two.example', 101, 202, 'DRAFT_READY', CURRENT_TIMESTAMP + interval '24 hours'),
  ('WO-STG203', 'https://stage2-three.example/', 'stage2-three.example', 101, 202, 'DRAFT_READY', CURRENT_TIMESTAMP + interval '24 hours');

INSERT INTO drafts(
  job_id, draft_version, recipient_email, recipient_hmac,
  subject, body_text, body_html, template_version, template_sha256
) VALUES
  ('WO-STG201', 1, 'review-one@stage2-one.example', repeat('a', 64), 'Synthetic review one', 'Synthetic body.', '<p>Synthetic body.</p>', 'synthetic-stage2-v1', repeat('1', 64)),
  ('WO-STG202', 1, 'review-two@stage2-two.example', repeat('b', 64), 'Synthetic review two', 'Synthetic body.', '<p>Synthetic body.</p>', 'synthetic-stage2-v1', repeat('1', 64)),
  ('WO-STG203', 1, 'review-three@stage2-three.example', repeat('c', 64), 'Synthetic review three', 'Synthetic body.', '<p>Synthetic body.</p>', 'synthetic-stage2-v1', repeat('1', 64));

INSERT INTO suppression(recipient_hmac, reason, source, safe_note)
VALUES (repeat('b', 64), 'OWNER_BLOCK', 'operator', 'Synthetic stage-2 smoke fixture')
ON CONFLICT (recipient_hmac) DO NOTHING;

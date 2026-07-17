BEGIN;

SET search_path TO workoutreach, public;

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;

ALTER TABLE drafts
  ADD COLUMN IF NOT EXISTS recipient_hmac char(64);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'drafts_recipient_hmac_check'
      AND conrelid = 'workoutreach.drafts'::regclass
  ) THEN
    ALTER TABLE drafts
      ADD CONSTRAINT drafts_recipient_hmac_check
      CHECK (recipient_hmac IS NULL OR recipient_hmac ~ '^[0-9a-f]{64}$');
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS approval_tokens (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  job_id text NOT NULL,
  draft_version integer NOT NULL,
  action text NOT NULL CHECK (action IN ('mock_send', 'regenerate', 'reject', 'select_recipient')),
  nonce_sha256 char(64) NOT NULL UNIQUE CHECK (nonce_sha256 ~ '^[0-9a-f]{64}$'),
  telegram_user_id bigint NOT NULL,
  telegram_chat_id bigint NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  invalidated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (job_id, draft_version) REFERENCES drafts(job_id, draft_version) ON DELETE CASCADE,
  CHECK (expires_at > created_at),
  CHECK (consumed_at IS NULL OR consumed_at >= created_at),
  CHECK (invalidated_at IS NULL OR invalidated_at >= created_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS approval_tokens_one_active_action
  ON approval_tokens(job_id, draft_version, action)
  WHERE consumed_at IS NULL AND invalidated_at IS NULL;

CREATE TABLE IF NOT EXISTS suppression (
  recipient_hmac char(64) PRIMARY KEY CHECK (recipient_hmac ~ '^[0-9a-f]{64}$'),
  reason text NOT NULL CHECK (reason IN (
    'OWNER_BLOCK', 'RECIPIENT_REQUEST', 'UNSUBSCRIBED', 'BOUNCED_PERMANENT', 'COMPLAINED', 'LEGAL_OR_POLICY'
  )),
  source text NOT NULL CHECK (source IN ('operator', 'provider_event', 'unsubscribe_endpoint', 'migration')),
  safe_note text,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (safe_note IS NULL OR char_length(safe_note) <= 240)
);

CREATE TABLE IF NOT EXISTS operator_actions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  action_key text NOT NULL UNIQUE CHECK (char_length(action_key) BETWEEN 1 AND 128),
  job_id text NOT NULL REFERENCES jobs(job_id) ON DELETE CASCADE,
  draft_version integer,
  action text NOT NULL CHECK (action IN ('mock_send', 'regenerate', 'reject', 'select_recipient', 'cancel', 'refresh')),
  result_code text NOT NULL,
  telegram_user_id bigint NOT NULL,
  telegram_chat_id bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (job_id, draft_version) REFERENCES drafts(job_id, draft_version) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS outbox (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  command_key text NOT NULL UNIQUE CHECK (char_length(command_key) BETWEEN 1 AND 128),
  operator_action_id bigint NOT NULL UNIQUE REFERENCES operator_actions(id),
  job_id text NOT NULL,
  draft_version integer NOT NULL,
  recipient_hmac char(64) NOT NULL CHECK (recipient_hmac ~ '^[0-9a-f]{64}$'),
  transport text NOT NULL DEFAULT 'mock' CHECK (transport = 'mock'),
  status text NOT NULL DEFAULT 'MOCK_PENDING' CHECK (status IN (
    'MOCK_PENDING', 'MOCK_CLAIMED', 'MOCK_ACCEPTED', 'CANCELLED', 'SUPPRESSION_BLOCKED'
  )),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 1),
  available_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  claimed_at timestamptz,
  claimed_by text,
  mock_accepted_at timestamptz,
  provider_message_id text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (job_id, draft_version) REFERENCES drafts(job_id, draft_version) ON DELETE RESTRICT,
  UNIQUE (job_id, draft_version),
  CHECK (provider_message_id IS NULL),
  CHECK (claimed_by IS NULL OR char_length(claimed_by) BETWEEN 1 AND 120),
  CHECK ((status = 'MOCK_ACCEPTED') = (mock_accepted_at IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS outbox_mock_claim_idx
  ON outbox(available_at, id)
  WHERE status = 'MOCK_PENDING';

CREATE TABLE IF NOT EXISTS message_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  job_id text NOT NULL REFERENCES jobs(job_id) ON DELETE CASCADE,
  outbox_id bigint REFERENCES outbox(id) ON DELETE SET NULL,
  provider_event_id text NOT NULL UNIQUE,
  provider_message_id text,
  event_type text NOT NULL CHECK (event_type IN (
    'MX_ACCEPTED', 'BOUNCED_TEMPORARY', 'BOUNCED_PERMANENT', 'COMPLAINED', 'UNSUBSCRIBED', 'REPLIED'
  )),
  occurred_at timestamptz NOT NULL,
  safe_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS stage2_safety_controls (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  live_send_enabled boolean NOT NULL DEFAULT false CHECK (live_send_enabled = false),
  mail_transport text NOT NULL DEFAULT 'disabled' CHECK (mail_transport = 'disabled'),
  daily_send_limit integer NOT NULL DEFAULT 0 CHECK (daily_send_limit = 0),
  kill_switch_enabled boolean NOT NULL DEFAULT true CHECK (kill_switch_enabled = true),
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO stage2_safety_controls(singleton) VALUES (true)
ON CONFLICT (singleton) DO NOTHING;

CREATE OR REPLACE FUNCTION issue_mock_approval_token(
  p_job_id text,
  p_draft_version integer,
  p_telegram_user_id bigint,
  p_telegram_chat_id bigint,
  p_ttl interval DEFAULT interval '24 hours'
) RETURNS TABLE(callback_data text, expires_at timestamptz)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = workoutreach, public
AS $$
DECLARE
  v_job jobs%ROWTYPE;
  v_nonce text;
  v_expires_at timestamptz;
BEGIN
  IF p_ttl <= interval '0 seconds' OR p_ttl > interval '24 hours' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'APPROVAL_TTL_INVALID';
  END IF;

  SELECT * INTO v_job FROM jobs WHERE job_id = p_job_id FOR UPDATE;
  IF NOT FOUND OR v_job.telegram_user_id <> p_telegram_user_id OR v_job.telegram_chat_id <> p_telegram_chat_id THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'APPROVAL_NOT_AUTHORIZED';
  END IF;
  IF v_job.status <> 'DRAFT_READY' OR v_job.expires_at <= CURRENT_TIMESTAMP THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'APPROVAL_STATE_INVALID';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM drafts
    WHERE job_id = p_job_id AND draft_version = p_draft_version AND recipient_hmac IS NOT NULL
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'APPROVAL_DRAFT_INVALID';
  END IF;

  UPDATE approval_tokens
  SET invalidated_at = CURRENT_TIMESTAMP
  WHERE job_id = p_job_id AND draft_version = p_draft_version AND action = 'mock_send'
    AND consumed_at IS NULL AND invalidated_at IS NULL;

  v_nonce := translate(rtrim(encode(gen_random_bytes(16), 'base64'), '='), '+/', '-_');
  v_expires_at := LEAST(CURRENT_TIMESTAMP + p_ttl, v_job.expires_at);

  INSERT INTO approval_tokens(
    job_id, draft_version, action, nonce_sha256,
    telegram_user_id, telegram_chat_id, expires_at
  ) VALUES (
    p_job_id, p_draft_version, 'mock_send',
    encode(digest(convert_to(v_nonce, 'UTF8'), 'sha256'), 'hex'),
    p_telegram_user_id, p_telegram_chat_id, v_expires_at
  );

  RETURN QUERY SELECT 'mock_send:' || p_job_id || ':' || v_nonce, v_expires_at;
END;
$$;

CREATE OR REPLACE FUNCTION handle_mock_send_callback(
  p_callback_data text,
  p_telegram_user_id bigint,
  p_telegram_chat_id bigint,
  p_action_key text
) RETURNS TABLE(result_code text, outbox_id bigint, job_status text)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = workoutreach, public
AS $$
DECLARE
  v_parts text[];
  v_job_id text;
  v_nonce text;
  v_job jobs%ROWTYPE;
  v_token approval_tokens%ROWTYPE;
  v_draft drafts%ROWTYPE;
  v_action_id bigint;
  v_outbox_id bigint;
  v_existing operator_actions%ROWTYPE;
BEGIN
  IF p_action_key IS NULL OR char_length(p_action_key) NOT BETWEEN 1 AND 128 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'ACTION_KEY_INVALID';
  END IF;
  v_parts := regexp_match(p_callback_data, '^mock_send:(WO-[A-Z0-9]{6}):([A-Za-z0-9_-]{22,43})$');
  IF v_parts IS NULL THEN
    RETURN QUERY SELECT 'CALLBACK_INVALID'::text, NULL::bigint, NULL::text;
    RETURN;
  END IF;
  v_job_id := v_parts[1];
  v_nonce := v_parts[2];

  SELECT * INTO v_job FROM jobs WHERE job_id = v_job_id FOR UPDATE;
  IF NOT FOUND OR v_job.telegram_user_id <> p_telegram_user_id OR v_job.telegram_chat_id <> p_telegram_chat_id THEN
    RETURN QUERY SELECT 'APPROVAL_NOT_AUTHORIZED'::text, NULL::bigint, NULL::text;
    RETURN;
  END IF;

  SELECT * INTO v_existing FROM operator_actions WHERE action_key = p_action_key;
  IF FOUND THEN
    SELECT id INTO v_outbox_id FROM outbox WHERE operator_action_id = v_existing.id;
    RETURN QUERY SELECT v_existing.result_code, v_outbox_id, v_job.status;
    RETURN;
  END IF;

  SELECT * INTO v_draft FROM drafts
  WHERE job_id = v_job_id
  ORDER BY draft_version DESC
  LIMIT 1;

  SELECT * INTO v_token FROM approval_tokens
  WHERE job_id = v_job_id
    AND draft_version = v_draft.draft_version
    AND action = 'mock_send'
    AND nonce_sha256 = encode(digest(convert_to(v_nonce, 'UTF8'), 'sha256'), 'hex')
  FOR UPDATE;

  IF NOT FOUND OR v_token.telegram_user_id <> p_telegram_user_id OR v_token.telegram_chat_id <> p_telegram_chat_id
     OR v_token.consumed_at IS NOT NULL OR v_token.invalidated_at IS NOT NULL OR v_token.expires_at <= CURRENT_TIMESTAMP THEN
    RETURN QUERY SELECT 'APPROVAL_TOKEN_INVALID'::text, NULL::bigint, v_job.status;
    RETURN;
  END IF;

  IF v_job.expires_at <= CURRENT_TIMESTAMP THEN
    UPDATE jobs SET status = 'EXPIRED' WHERE job_id = v_job_id;
    RETURN QUERY SELECT 'APPROVAL_EXPIRED'::text, NULL::bigint, 'EXPIRED'::text;
    RETURN;
  END IF;

  IF v_job.status = 'APPROVED' THEN
    SELECT id INTO v_outbox_id FROM outbox WHERE job_id = v_job_id AND draft_version = v_draft.draft_version;
    RETURN QUERY SELECT 'MOCK_OUTBOX_ALREADY_EXISTS'::text, v_outbox_id, v_job.status;
    RETURN;
  END IF;
  IF v_job.status <> 'DRAFT_READY' THEN
    RETURN QUERY SELECT 'APPROVAL_STATE_INVALID'::text, NULL::bigint, v_job.status;
    RETURN;
  END IF;
  IF v_draft.recipient_hmac IS NULL THEN
    RETURN QUERY SELECT 'RECIPIENT_FINGERPRINT_MISSING'::text, NULL::bigint, v_job.status;
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM suppression WHERE recipient_hmac = v_draft.recipient_hmac) THEN
    INSERT INTO audit_log(job_id, event_type, actor_type, safe_metadata)
    VALUES (v_job_id, 'SUPPRESSION_BLOCKED', 'operator', jsonb_build_object('draft_version', v_draft.draft_version));
    RETURN QUERY SELECT 'SUPPRESSION_BLOCKED'::text, NULL::bigint, v_job.status;
    RETURN;
  END IF;

  UPDATE approval_tokens SET consumed_at = CURRENT_TIMESTAMP WHERE id = v_token.id;
  UPDATE jobs SET status = 'APPROVED' WHERE job_id = v_job_id;

  INSERT INTO operator_actions(
    action_key, job_id, draft_version, action, result_code,
    telegram_user_id, telegram_chat_id
  ) VALUES (
    p_action_key, v_job_id, v_draft.draft_version, 'mock_send', 'MOCK_OUTBOX_CREATED',
    p_telegram_user_id, p_telegram_chat_id
  ) RETURNING id INTO v_action_id;

  INSERT INTO outbox(
    command_key, operator_action_id, job_id, draft_version, recipient_hmac
  ) VALUES (
    p_action_key, v_action_id, v_job_id, v_draft.draft_version, v_draft.recipient_hmac
  ) RETURNING id INTO v_outbox_id;

  INSERT INTO audit_log(job_id, event_type, actor_type, safe_metadata)
  VALUES (v_job_id, 'MOCK_OUTBOX_CREATED', 'operator', jsonb_build_object(
    'draft_version', v_draft.draft_version,
    'outbox_id', v_outbox_id,
    'transport', 'mock'
  ));

  RETURN QUERY SELECT 'MOCK_OUTBOX_CREATED'::text, v_outbox_id, 'APPROVED'::text;
END;
$$;

CREATE OR REPLACE FUNCTION dispatch_next_mock_outbox(p_worker_id text)
RETURNS TABLE(result_code text, outbox_id bigint, job_id text, draft_version integer)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = workoutreach, public
AS $$
DECLARE
  v_outbox outbox%ROWTYPE;
BEGIN
  IF p_worker_id IS NULL OR char_length(p_worker_id) NOT BETWEEN 1 AND 120 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'WORKER_ID_INVALID';
  END IF;

  SELECT * INTO v_outbox FROM outbox
  WHERE status = 'MOCK_PENDING' AND available_at <= CURRENT_TIMESTAMP
  ORDER BY available_at, id
  FOR UPDATE SKIP LOCKED
  LIMIT 1;

  IF NOT FOUND THEN RETURN; END IF;

  IF EXISTS (SELECT 1 FROM suppression WHERE recipient_hmac = v_outbox.recipient_hmac) THEN
    UPDATE outbox
    SET status = 'SUPPRESSION_BLOCKED', updated_at = CURRENT_TIMESTAMP
    WHERE id = v_outbox.id;
    INSERT INTO audit_log(job_id, event_type, actor_type, safe_metadata)
    VALUES (v_outbox.job_id, 'SUPPRESSION_BLOCKED_AT_DISPATCH', 'system', jsonb_build_object('outbox_id', v_outbox.id));
    RETURN QUERY SELECT 'SUPPRESSION_BLOCKED'::text, v_outbox.id, v_outbox.job_id, v_outbox.draft_version;
    RETURN;
  END IF;

  UPDATE outbox
  SET status = 'MOCK_CLAIMED', claimed_at = CURRENT_TIMESTAMP, claimed_by = p_worker_id,
      attempt_count = 1, updated_at = CURRENT_TIMESTAMP
  WHERE id = v_outbox.id;

  UPDATE outbox
  SET status = 'MOCK_ACCEPTED', mock_accepted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
  WHERE id = v_outbox.id;

  INSERT INTO audit_log(job_id, event_type, actor_type, safe_metadata)
  VALUES (v_outbox.job_id, 'MOCK_DISPATCH_ACCEPTED', 'system', jsonb_build_object(
    'outbox_id', v_outbox.id,
    'transport', 'mock'
  ));

  RETURN QUERY SELECT 'MOCK_ACCEPTED'::text, v_outbox.id, v_outbox.job_id, v_outbox.draft_version;
END;
$$;

INSERT INTO schema_migrations (version) VALUES ('003_stage_2_mock_outbox')
ON CONFLICT DO NOTHING;

COMMIT;

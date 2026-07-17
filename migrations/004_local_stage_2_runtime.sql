BEGIN;

SET search_path TO workoutreach, public;

CREATE OR REPLACE FUNCTION assert_job_status_transition()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = workoutreach, public
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT EXISTS (
    SELECT 1 FROM allowed_job_transitions
    WHERE from_status = OLD.status AND to_status = NEW.status
  ) THEN
    RAISE EXCEPTION 'invalid job status transition: % -> %', OLD.status, NEW.status;
  END IF;
  NEW.updated_at := CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION issue_local_review_token(
  p_job_id text,
  p_draft_version integer,
  p_action text,
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
  IF p_action NOT IN ('mock_send', 'regenerate', 'reject') THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'REVIEW_ACTION_INVALID';
  END IF;
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
  WHERE job_id = p_job_id AND draft_version = p_draft_version AND action = p_action
    AND consumed_at IS NULL AND invalidated_at IS NULL;

  v_nonce := translate(rtrim(encode(gen_random_bytes(16), 'base64'), '='), '+/', '-_');
  v_expires_at := LEAST(CURRENT_TIMESTAMP + p_ttl, v_job.expires_at);

  INSERT INTO approval_tokens(
    job_id, draft_version, action, nonce_sha256,
    telegram_user_id, telegram_chat_id, expires_at
  ) VALUES (
    p_job_id, p_draft_version, p_action,
    encode(digest(convert_to(v_nonce, 'UTF8'), 'sha256'), 'hex'),
    p_telegram_user_id, p_telegram_chat_id, v_expires_at
  );

  RETURN QUERY SELECT p_action || ':' || p_job_id || ':' || v_nonce, v_expires_at;
END;
$$;

CREATE OR REPLACE FUNCTION handle_local_review_action(
  p_callback_data text,
  p_telegram_user_id bigint,
  p_telegram_chat_id bigint,
  p_action_key text
) RETURNS TABLE(
  result_code text,
  job_id text,
  draft_version integer,
  canonical_url text,
  job_status text
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = workoutreach, public
AS $$
DECLARE
  v_parts text[];
  v_action text;
  v_job_id text;
  v_nonce text;
  v_job jobs%ROWTYPE;
  v_token approval_tokens%ROWTYPE;
  v_draft drafts%ROWTYPE;
  v_existing operator_actions%ROWTYPE;
  v_result text;
BEGIN
  IF p_action_key IS NULL OR char_length(p_action_key) NOT BETWEEN 1 AND 128 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'ACTION_KEY_INVALID';
  END IF;
  v_parts := regexp_match(p_callback_data, '^(regenerate|reject):(WO-[A-Z0-9]{6}):([A-Za-z0-9_-]{22,43})$');
  IF v_parts IS NULL THEN
    RETURN QUERY SELECT 'CALLBACK_INVALID'::text, NULL::text, NULL::integer, NULL::text, NULL::text;
    RETURN;
  END IF;
  v_action := v_parts[1];
  v_job_id := v_parts[2];
  v_nonce := v_parts[3];

  SELECT * INTO v_job FROM jobs WHERE jobs.job_id = v_job_id FOR UPDATE;
  IF NOT FOUND OR v_job.telegram_user_id <> p_telegram_user_id OR v_job.telegram_chat_id <> p_telegram_chat_id THEN
    RETURN QUERY SELECT 'APPROVAL_NOT_AUTHORIZED'::text, NULL::text, NULL::integer, NULL::text, NULL::text;
    RETURN;
  END IF;

  SELECT * INTO v_existing FROM operator_actions WHERE action_key = p_action_key;
  IF FOUND THEN
    RETURN QUERY SELECT v_existing.result_code, v_job.job_id, v_existing.draft_version, v_job.canonical_url, v_job.status;
    RETURN;
  END IF;

  SELECT * INTO v_draft FROM drafts
  WHERE drafts.job_id = v_job_id
  ORDER BY drafts.draft_version DESC
  LIMIT 1;

  SELECT * INTO v_token FROM approval_tokens
  WHERE approval_tokens.job_id = v_job_id
    AND approval_tokens.draft_version = v_draft.draft_version
    AND approval_tokens.action = v_action
    AND nonce_sha256 = encode(digest(convert_to(v_nonce, 'UTF8'), 'sha256'), 'hex')
  FOR UPDATE;

  IF NOT FOUND OR v_token.telegram_user_id <> p_telegram_user_id OR v_token.telegram_chat_id <> p_telegram_chat_id
     OR v_token.consumed_at IS NOT NULL OR v_token.invalidated_at IS NOT NULL OR v_token.expires_at <= CURRENT_TIMESTAMP THEN
    RETURN QUERY SELECT 'APPROVAL_TOKEN_INVALID'::text, v_job.job_id, v_draft.draft_version, v_job.canonical_url, v_job.status;
    RETURN;
  END IF;
  IF v_job.expires_at <= CURRENT_TIMESTAMP THEN
    UPDATE jobs SET status = 'EXPIRED' WHERE jobs.job_id = v_job_id;
    RETURN QUERY SELECT 'APPROVAL_EXPIRED'::text, v_job.job_id, v_draft.draft_version, v_job.canonical_url, 'EXPIRED'::text;
    RETURN;
  END IF;
  IF v_job.status <> 'DRAFT_READY' THEN
    RETURN QUERY SELECT 'APPROVAL_STATE_INVALID'::text, v_job.job_id, v_draft.draft_version, v_job.canonical_url, v_job.status;
    RETURN;
  END IF;
  IF v_action = 'regenerate' AND v_draft.draft_version >= 3 THEN
    RETURN QUERY SELECT 'REGENERATION_LIMIT'::text, v_job.job_id, v_draft.draft_version, v_job.canonical_url, v_job.status;
    RETURN;
  END IF;

  UPDATE approval_tokens
  SET consumed_at = CASE WHEN id = v_token.id THEN CURRENT_TIMESTAMP ELSE consumed_at END,
      invalidated_at = CASE WHEN id <> v_token.id AND consumed_at IS NULL AND invalidated_at IS NULL THEN CURRENT_TIMESTAMP ELSE invalidated_at END
  WHERE approval_tokens.job_id = v_job_id AND approval_tokens.draft_version = v_draft.draft_version;

  IF v_action = 'reject' THEN
    UPDATE jobs SET status = 'REJECTED' WHERE jobs.job_id = v_job_id;
    v_result := 'REJECTED';
  ELSE
    UPDATE jobs SET status = 'ANALYZING' WHERE jobs.job_id = v_job_id;
    v_result := 'REGENERATION_STARTED';
  END IF;

  INSERT INTO operator_actions(
    action_key, job_id, draft_version, action, result_code,
    telegram_user_id, telegram_chat_id
  ) VALUES (
    p_action_key, v_job_id, v_draft.draft_version, v_action, v_result,
    p_telegram_user_id, p_telegram_chat_id
  );

  INSERT INTO audit_log(job_id, event_type, actor_type, safe_metadata)
  VALUES (v_job_id, v_result, 'operator', jsonb_build_object('draft_version', v_draft.draft_version));

  RETURN QUERY SELECT v_result, v_job.job_id, v_draft.draft_version, v_job.canonical_url,
    CASE WHEN v_action = 'reject' THEN 'REJECTED'::text ELSE 'ANALYZING'::text END;
END;
$$;

INSERT INTO schema_migrations (version) VALUES ('004_local_stage_2_runtime')
ON CONFLICT DO NOTHING;

COMMIT;

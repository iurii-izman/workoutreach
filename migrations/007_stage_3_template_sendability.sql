BEGIN;

SET search_path TO workoutreach, public;

ALTER TABLE drafts DROP CONSTRAINT IF EXISTS drafts_sendable_check;

CREATE OR REPLACE FUNCTION issue_local_review_token(
  p_job_id text,p_draft_version integer,p_action text,p_telegram_user_id bigint,p_telegram_chat_id bigint,
  p_ttl interval DEFAULT interval '24 hours'
) RETURNS TABLE(callback_data text,expires_at timestamptz)
LANGUAGE plpgsql SECURITY INVOKER SET search_path=workoutreach,public AS $$
DECLARE v_job jobs%ROWTYPE; v_nonce text; v_expires_at timestamptz;
BEGIN
  IF p_action NOT IN ('mock_send','smtp_send','regenerate','reject') THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='REVIEW_ACTION_INVALID'; END IF;
  IF p_ttl<=interval '0 seconds' OR p_ttl>interval '24 hours' THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='APPROVAL_TTL_INVALID'; END IF;
  SELECT * INTO v_job FROM jobs WHERE job_id=p_job_id FOR UPDATE;
  IF NOT FOUND OR v_job.telegram_user_id<>p_telegram_user_id OR v_job.telegram_chat_id<>p_telegram_chat_id THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='APPROVAL_NOT_AUTHORIZED'; END IF;
  IF v_job.status<>'DRAFT_READY' OR v_job.expires_at<=CURRENT_TIMESTAMP THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='APPROVAL_STATE_INVALID'; END IF;
  IF NOT EXISTS(SELECT 1 FROM drafts WHERE job_id=p_job_id AND draft_version=p_draft_version AND recipient_hmac IS NOT NULL) THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='APPROVAL_DRAFT_INVALID'; END IF;
  IF p_action='smtp_send' AND NOT EXISTS(SELECT 1 FROM drafts WHERE job_id=p_job_id AND draft_version=p_draft_version AND sendable=true) THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='TEMPLATE_NOT_SENDABLE'; END IF;
  IF p_action='smtp_send' AND NOT EXISTS(SELECT 1 FROM mail_runtime_controls WHERE singleton AND live_send_enabled AND mail_transport='smtp' AND NOT kill_switch_enabled) THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='LIVE_SEND_BLOCKED'; END IF;
  UPDATE approval_tokens SET invalidated_at=CURRENT_TIMESTAMP WHERE job_id=p_job_id AND draft_version=p_draft_version AND action=p_action AND consumed_at IS NULL AND invalidated_at IS NULL;
  v_nonce:=translate(rtrim(encode(gen_random_bytes(16),'base64'),'='),'+/','-_');
  v_expires_at:=LEAST(CURRENT_TIMESTAMP+p_ttl,v_job.expires_at);
  INSERT INTO approval_tokens(job_id,draft_version,action,nonce_sha256,telegram_user_id,telegram_chat_id,expires_at)
  VALUES(p_job_id,p_draft_version,p_action,encode(digest(convert_to(v_nonce,'UTF8'),'sha256'),'hex'),p_telegram_user_id,p_telegram_chat_id,v_expires_at);
  RETURN QUERY SELECT p_action||':'||p_job_id||':'||v_nonce,v_expires_at;
END;
$$;

CREATE OR REPLACE FUNCTION handle_smtp_send_callback(p_callback_data text,p_telegram_user_id bigint,p_telegram_chat_id bigint,p_action_key text)
RETURNS TABLE(result_code text,outbox_id bigint,job_status text)
LANGUAGE plpgsql SECURITY INVOKER SET search_path=workoutreach,public AS $$
DECLARE v_parts text[]; v_job_id text; v_nonce text; v_job jobs%ROWTYPE; v_token approval_tokens%ROWTYPE; v_draft drafts%ROWTYPE; v_existing operator_actions%ROWTYPE; v_action_id bigint; v_outbox_id bigint; v_limit integer;
BEGIN
  IF p_action_key IS NULL OR char_length(p_action_key) NOT BETWEEN 1 AND 128 THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='ACTION_KEY_INVALID'; END IF;
  v_parts:=regexp_match(p_callback_data,'^smtp_send:(WO-[A-Z0-9]{6}):([A-Za-z0-9_-]{22,43})$');
  IF v_parts IS NULL THEN RETURN QUERY SELECT 'CALLBACK_INVALID'::text,NULL::bigint,NULL::text; RETURN; END IF;
  v_job_id:=v_parts[1]; v_nonce:=v_parts[2];
  SELECT * INTO v_job FROM jobs WHERE job_id=v_job_id FOR UPDATE;
  IF NOT FOUND OR v_job.telegram_user_id<>p_telegram_user_id OR v_job.telegram_chat_id<>p_telegram_chat_id THEN RETURN QUERY SELECT 'APPROVAL_NOT_AUTHORIZED'::text,NULL::bigint,NULL::text; RETURN; END IF;
  SELECT * INTO v_existing FROM operator_actions WHERE action_key=p_action_key;
  IF FOUND THEN SELECT id INTO v_outbox_id FROM outbox WHERE operator_action_id=v_existing.id; RETURN QUERY SELECT v_existing.result_code,v_outbox_id,v_job.status; RETURN; END IF;
  SELECT * INTO v_draft FROM drafts WHERE job_id=v_job_id ORDER BY draft_version DESC LIMIT 1;
  IF NOT FOUND OR v_draft.sendable<>true THEN RETURN QUERY SELECT 'TEMPLATE_NOT_SENDABLE'::text,NULL::bigint,v_job.status; RETURN; END IF;
  SELECT * INTO v_token FROM approval_tokens WHERE job_id=v_job_id AND draft_version=v_draft.draft_version AND action='smtp_send' AND nonce_sha256=encode(digest(convert_to(v_nonce,'UTF8'),'sha256'),'hex') FOR UPDATE;
  IF NOT FOUND OR v_token.telegram_user_id<>p_telegram_user_id OR v_token.telegram_chat_id<>p_telegram_chat_id OR v_token.consumed_at IS NOT NULL OR v_token.invalidated_at IS NOT NULL OR v_token.expires_at<=CURRENT_TIMESTAMP THEN RETURN QUERY SELECT 'APPROVAL_TOKEN_INVALID'::text,NULL::bigint,v_job.status; RETURN; END IF;
  SELECT daily_send_limit INTO v_limit FROM mail_runtime_controls WHERE singleton AND live_send_enabled AND mail_transport='smtp' AND NOT kill_switch_enabled FOR UPDATE;
  IF NOT FOUND THEN RETURN QUERY SELECT 'LIVE_SEND_BLOCKED'::text,NULL::bigint,v_job.status; RETURN; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('workoutreach-mail-budget:'||(CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date::text,0));
  IF (SELECT count(*) FROM outbox WHERE transport='smtp' AND created_at >= date_trunc('day',CURRENT_TIMESTAMP AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')>=v_limit THEN RETURN QUERY SELECT 'DAILY_SEND_LIMIT'::text,NULL::bigint,v_job.status; RETURN; END IF;
  IF v_job.status<>'DRAFT_READY' OR v_job.expires_at<=CURRENT_TIMESTAMP THEN RETURN QUERY SELECT 'APPROVAL_STATE_INVALID'::text,NULL::bigint,v_job.status; RETURN; END IF;
  IF EXISTS(SELECT 1 FROM suppression WHERE recipient_hmac=v_draft.recipient_hmac) THEN RETURN QUERY SELECT 'SUPPRESSION_BLOCKED'::text,NULL::bigint,v_job.status; RETURN; END IF;
  UPDATE approval_tokens SET consumed_at=CASE WHEN id=v_token.id THEN CURRENT_TIMESTAMP ELSE consumed_at END,invalidated_at=CASE WHEN id<>v_token.id AND consumed_at IS NULL AND invalidated_at IS NULL THEN CURRENT_TIMESTAMP ELSE invalidated_at END WHERE job_id=v_job_id AND draft_version=v_draft.draft_version;
  UPDATE jobs SET status='APPROVED' WHERE job_id=v_job_id;
  INSERT INTO operator_actions(action_key,job_id,draft_version,action,result_code,telegram_user_id,telegram_chat_id) VALUES(p_action_key,v_job_id,v_draft.draft_version,'smtp_send','SMTP_OUTBOX_CREATED',p_telegram_user_id,p_telegram_chat_id) RETURNING id INTO v_action_id;
  INSERT INTO outbox(command_key,operator_action_id,job_id,draft_version,recipient_hmac,transport,status) VALUES(p_action_key,v_action_id,v_job_id,v_draft.draft_version,v_draft.recipient_hmac,'smtp','SMTP_PENDING') RETURNING id INTO v_outbox_id;
  INSERT INTO audit_log(job_id,event_type,actor_type,safe_metadata) VALUES(v_job_id,'SMTP_OUTBOX_CREATED','operator',jsonb_build_object('draft_version',v_draft.draft_version,'outbox_id',v_outbox_id));
  RETURN QUERY SELECT 'SMTP_OUTBOX_CREATED'::text,v_outbox_id,'APPROVED'::text;
END;
$$;

CREATE OR REPLACE FUNCTION claim_next_smtp_outbox(p_worker_id text)
RETURNS TABLE(outbox_id bigint,job_id text,draft_version integer,recipient_email text,subject text,body_text text,body_html text,attachment_filename text,attachment_sha256 char(64),telegram_chat_id bigint)
LANGUAGE plpgsql SECURITY INVOKER SET search_path=workoutreach,public AS $$
DECLARE v_outbox outbox%ROWTYPE;
BEGIN
  IF p_worker_id IS NULL OR char_length(p_worker_id) NOT BETWEEN 1 AND 120 THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='WORKER_ID_INVALID'; END IF;
  IF NOT EXISTS(SELECT 1 FROM mail_runtime_controls WHERE singleton AND live_send_enabled AND mail_transport='smtp' AND NOT kill_switch_enabled) THEN RETURN; END IF;
  SELECT o.* INTO v_outbox FROM outbox o JOIN drafts d ON (d.job_id,d.draft_version)=(o.job_id,o.draft_version) WHERE o.transport='smtp' AND o.status='SMTP_PENDING' AND o.available_at<=CURRENT_TIMESTAMP AND d.sendable=true ORDER BY o.available_at,o.id FOR UPDATE OF o SKIP LOCKED LIMIT 1;
  IF NOT FOUND THEN RETURN; END IF;
  IF EXISTS(SELECT 1 FROM suppression WHERE recipient_hmac=v_outbox.recipient_hmac) THEN UPDATE outbox SET status='SUPPRESSION_BLOCKED',updated_at=CURRENT_TIMESTAMP WHERE id=v_outbox.id; RETURN; END IF;
  UPDATE outbox SET status='SMTP_CLAIMED',claimed_at=CURRENT_TIMESTAMP,claimed_by=p_worker_id,attempt_count=1,updated_at=CURRENT_TIMESTAMP WHERE id=v_outbox.id;
  UPDATE jobs SET status='SENDING' WHERE jobs.job_id=v_outbox.job_id;
  RETURN QUERY SELECT o.id,o.job_id,o.draft_version,d.recipient_email,d.subject,d.body_text,d.body_html,d.attachment_filename,d.attachment_sha256,j.telegram_chat_id FROM outbox o JOIN drafts d ON (d.job_id,d.draft_version)=(o.job_id,o.draft_version) JOIN jobs j ON j.job_id=o.job_id WHERE o.id=v_outbox.id AND d.sendable=true;
END;
$$;

INSERT INTO schema_migrations(version) VALUES('007_stage_3_template_sendability') ON CONFLICT DO NOTHING;

COMMIT;

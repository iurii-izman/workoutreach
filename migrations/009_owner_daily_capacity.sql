BEGIN;

SET search_path TO workoutreach, public;

-- The owner approved a 20–30 message/day operating target. Keep a finite,
-- database-enforced ceiling instead of removing the safety control entirely.
ALTER TABLE mail_runtime_controls
  DROP CONSTRAINT IF EXISTS mail_runtime_controls_daily_send_limit_check;
ALTER TABLE mail_runtime_controls
  DROP CONSTRAINT IF EXISTS mail_runtime_controls_check;
ALTER TABLE mail_runtime_controls
  DROP CONSTRAINT IF EXISTS mail_runtime_controls_state_check;

ALTER TABLE mail_runtime_controls
  ADD CONSTRAINT mail_runtime_controls_daily_send_limit_check
    CHECK (daily_send_limit BETWEEN 0 AND 30);
ALTER TABLE mail_runtime_controls
  ADD CONSTRAINT mail_runtime_controls_state_check CHECK (
    (live_send_enabled=false AND mail_transport='disabled' AND daily_send_limit=0 AND kill_switch_enabled=true)
    OR (live_send_enabled=true AND mail_transport='smtp' AND daily_send_limit BETWEEN 1 AND 30 AND kill_switch_enabled=false)
  );

CREATE OR REPLACE FUNCTION configure_local_smtp_runtime(p_enabled boolean,p_daily_limit integer DEFAULT 0)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=workoutreach,public AS $$
BEGIN
  IF p_enabled AND p_daily_limit NOT BETWEEN 1 AND 30 THEN
    RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='DAILY_SEND_LIMIT_INVALID';
  END IF;
  UPDATE mail_runtime_controls SET
    live_send_enabled=p_enabled,
    mail_transport=CASE WHEN p_enabled THEN 'smtp' ELSE 'disabled' END,
    daily_send_limit=CASE WHEN p_enabled THEN p_daily_limit ELSE 0 END,
    kill_switch_enabled=NOT p_enabled,
    updated_at=CURRENT_TIMESTAMP
  WHERE singleton=true;
END;
$$;

CREATE OR REPLACE FUNCTION reserve_local_model_run(
  p_job_id text,
  p_draft_version integer,
  p_daily_analysis_limit integer
) RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = workoutreach, public
AS $$
DECLARE
  v_date date := (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date;
  v_count integer;
BEGIN
  IF p_daily_analysis_limit NOT BETWEEN 1 AND 40 OR p_draft_version NOT BETWEEN 1 AND 3 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'MODEL_BUDGET_CONFIG_INVALID';
  END IF;
  IF EXISTS (SELECT 1 FROM model_runs WHERE job_id = p_job_id AND draft_version = p_draft_version) THEN
    RETURN true;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('workoutreach-model-budget:' || v_date::text, 0));
  SELECT count(*) INTO v_count FROM model_runs WHERE run_date = v_date;
  IF v_count >= p_daily_analysis_limit THEN RETURN false; END IF;
  INSERT INTO model_runs(job_id,draft_version,run_date) VALUES(p_job_id,p_draft_version,v_date);
  RETURN true;
END;
$$;

INSERT INTO schema_migrations(version) VALUES('009_owner_daily_capacity') ON CONFLICT DO NOTHING;

COMMIT;

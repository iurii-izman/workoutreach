BEGIN;

SET search_path TO workoutreach, public;

CREATE TABLE IF NOT EXISTS model_runs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  job_id text NOT NULL REFERENCES jobs(job_id) ON DELETE CASCADE,
  draft_version integer NOT NULL CHECK (draft_version BETWEEN 1 AND 3),
  run_date date NOT NULL DEFAULT ((CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date),
  reserved_calls integer NOT NULL DEFAULT 2 CHECK (reserved_calls = 2),
  status text NOT NULL DEFAULT 'RESERVED' CHECK (status IN ('RESERVED', 'COMPLETED', 'FAILED')),
  usage jsonb,
  reserved_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at timestamptz,
  UNIQUE (job_id, draft_version),
  CHECK ((status = 'COMPLETED') = (completed_at IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS model_runs_daily_budget_idx ON model_runs(run_date);

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
  IF p_daily_analysis_limit NOT BETWEEN 1 AND 20 OR p_draft_version NOT BETWEEN 1 AND 3 THEN
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

INSERT INTO schema_migrations (version) VALUES ('005_local_model_budget')
ON CONFLICT DO NOTHING;

COMMIT;

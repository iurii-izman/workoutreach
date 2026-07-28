BEGIN;

SET search_path TO workoutreach, public;

INSERT INTO allowed_job_transitions(from_status,to_status)
VALUES ('FAILED','ANALYZING')
ON CONFLICT DO NOTHING;

ALTER TABLE model_runs
  DROP CONSTRAINT IF EXISTS model_runs_reserved_calls_check;
ALTER TABLE model_runs
  ALTER COLUMN reserved_calls SET DEFAULT 3;
ALTER TABLE model_runs
  ADD CONSTRAINT model_runs_reserved_calls_check
  CHECK (reserved_calls BETWEEN 1 AND 3);

INSERT INTO schema_migrations(version)
VALUES ('012_universal_first_resilience')
ON CONFLICT DO NOTHING;

COMMIT;

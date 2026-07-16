BEGIN;

CREATE SCHEMA IF NOT EXISTS workoutreach AUTHORIZATION workoutreach_app;
SET search_path TO workoutreach, public;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS operator_allowlist (
  telegram_user_id bigint NOT NULL,
  telegram_chat_id bigint NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (telegram_user_id, telegram_chat_id)
);

CREATE TABLE IF NOT EXISTS jobs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  job_id text NOT NULL UNIQUE CHECK (job_id ~ '^WO-[A-Z0-9]{6}$'),
  canonical_url text NOT NULL,
  hostname text NOT NULL,
  telegram_user_id bigint NOT NULL,
  telegram_chat_id bigint NOT NULL,
  status text NOT NULL CHECK (status IN (
    'RECEIVED', 'FETCHING', 'ANALYZING', 'NEEDS_CONTACT', 'NEEDS_REVIEW',
    'DRAFT_READY', 'APPROVED', 'SENDING', 'PROVIDER_ACCEPTED', 'REJECTED',
    'CANCELLED', 'EXPIRED', 'FAILED'
  )),
  error_code text,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at timestamptz NOT NULL,
  CHECK (expires_at > created_at)
);

CREATE TABLE IF NOT EXISTS allowed_job_transitions (
  from_status text NOT NULL,
  to_status text NOT NULL,
  PRIMARY KEY (from_status, to_status)
);

INSERT INTO allowed_job_transitions (from_status, to_status) VALUES
  ('RECEIVED', 'FETCHING'), ('RECEIVED', 'CANCELLED'), ('RECEIVED', 'FAILED'),
  ('FETCHING', 'ANALYZING'), ('FETCHING', 'NEEDS_REVIEW'), ('FETCHING', 'FAILED'), ('FETCHING', 'CANCELLED'),
  ('ANALYZING', 'NEEDS_CONTACT'), ('ANALYZING', 'NEEDS_REVIEW'), ('ANALYZING', 'DRAFT_READY'), ('ANALYZING', 'FAILED'), ('ANALYZING', 'CANCELLED'),
  ('NEEDS_CONTACT', 'ANALYZING'), ('NEEDS_CONTACT', 'CANCELLED'), ('NEEDS_CONTACT', 'EXPIRED'),
  ('NEEDS_REVIEW', 'ANALYZING'), ('NEEDS_REVIEW', 'REJECTED'), ('NEEDS_REVIEW', 'CANCELLED'), ('NEEDS_REVIEW', 'EXPIRED'),
  ('DRAFT_READY', 'ANALYZING'), ('DRAFT_READY', 'APPROVED'), ('DRAFT_READY', 'REJECTED'), ('DRAFT_READY', 'CANCELLED'), ('DRAFT_READY', 'EXPIRED'),
  ('APPROVED', 'SENDING'), ('APPROVED', 'FAILED'),
  ('SENDING', 'PROVIDER_ACCEPTED'), ('SENDING', 'FAILED')
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION assert_job_status_transition()
RETURNS trigger LANGUAGE plpgsql AS $$
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

DROP TRIGGER IF EXISTS jobs_status_transition ON jobs;
CREATE TRIGGER jobs_status_transition
BEFORE UPDATE ON jobs
FOR EACH ROW EXECUTE FUNCTION assert_job_status_transition();

CREATE TABLE IF NOT EXISTS telegram_updates (
  update_id bigint PRIMARY KEY,
  telegram_user_id bigint NOT NULL,
  telegram_chat_id bigint NOT NULL,
  job_id text REFERENCES jobs(job_id),
  result_code text NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS pages (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  job_id text NOT NULL REFERENCES jobs(job_id) ON DELETE CASCADE,
  source_id text NOT NULL CHECK (source_id ~ '^p[0-9]{2}$'),
  source_url text NOT NULL,
  source_type text NOT NULL,
  title text,
  content_sha256 char(64) NOT NULL,
  normalized_text text NOT NULL CHECK (char_length(normalized_text) <= 120000),
  fetched_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (job_id, source_id),
  UNIQUE (job_id, source_url)
);

CREATE TABLE IF NOT EXISTS contact_candidates (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  job_id text NOT NULL REFERENCES jobs(job_id) ON DELETE CASCADE,
  email text NOT NULL,
  normalized_email text NOT NULL,
  category text NOT NULL CHECK (category IN (
    'general', 'sales', 'support', 'recruiting', 'privacy_or_legal', 'personal_named', 'unknown'
  )),
  source_id text NOT NULL,
  source_url text NOT NULL,
  source_excerpt text NOT NULL,
  automatic_selection_allowed boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (job_id, normalized_email)
);

CREATE TABLE IF NOT EXISTS analyses (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  job_id text NOT NULL REFERENCES jobs(job_id) ON DELETE CASCADE,
  stage text NOT NULL CHECK (stage IN ('fact', 'phrase', 'aggregate')),
  version integer NOT NULL CHECK (version > 0),
  model_id text NOT NULL,
  prompt_version text NOT NULL,
  prompt_sha256 char(64) NOT NULL,
  schema_version text NOT NULL,
  schema_sha256 char(64) NOT NULL,
  offer_version text,
  offer_sha256 char(64),
  result jsonb NOT NULL,
  decision text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (job_id, stage, version)
);

CREATE TABLE IF NOT EXISTS drafts (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  job_id text NOT NULL REFERENCES jobs(job_id) ON DELETE CASCADE,
  draft_version integer NOT NULL CHECK (draft_version BETWEEN 1 AND 3),
  recipient_email text NOT NULL,
  subject text NOT NULL,
  body_text text NOT NULL,
  body_html text NOT NULL,
  template_version text NOT NULL,
  template_sha256 char(64) NOT NULL,
  sendable boolean NOT NULL DEFAULT false CHECK (sendable = false),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (job_id, draft_version)
);

CREATE TABLE IF NOT EXISTS audit_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  job_id text REFERENCES jobs(job_id) ON DELETE SET NULL,
  event_type text NOT NULL,
  actor_type text NOT NULL,
  safe_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE OR REPLACE FUNCTION reject_immutable_update()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% rows are immutable', TG_TABLE_NAME;
END;
$$;

DROP TRIGGER IF EXISTS analyses_immutable ON analyses;
CREATE TRIGGER analyses_immutable BEFORE UPDATE ON analyses
FOR EACH ROW EXECUTE FUNCTION reject_immutable_update();

DROP TRIGGER IF EXISTS drafts_immutable ON drafts;
CREATE TRIGGER drafts_immutable BEFORE UPDATE ON drafts
FOR EACH ROW EXECUTE FUNCTION reject_immutable_update();

INSERT INTO schema_migrations (version) VALUES ('001_stage_0_1')
ON CONFLICT DO NOTHING;

COMMIT;

BEGIN;

SET search_path TO workoutreach, public;

ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS campaign_type text NOT NULL DEFAULT 'career_outreach';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'jobs_campaign_type_check'
      AND conrelid = 'workoutreach.jobs'::regclass
  ) THEN
    ALTER TABLE jobs
      ADD CONSTRAINT jobs_campaign_type_check
      CHECK (campaign_type IN ('career_outreach'));
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS phone_candidates (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  job_id text NOT NULL REFERENCES jobs(job_id) ON DELETE CASCADE,
  phone text NOT NULL,
  normalized_phone text NOT NULL,
  source_id text NOT NULL,
  source_url text NOT NULL,
  source_excerpt text NOT NULL,
  decision text NOT NULL CHECK (decision IN ('SELECTED_FOR_REVIEW', 'NEEDS_REVIEW', 'NOT_FOUND')),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (job_id, normalized_phone)
);

ALTER TABLE drafts
  ADD COLUMN IF NOT EXISTS attachment_filename text,
  ADD COLUMN IF NOT EXISTS attachment_mime_type text,
  ADD COLUMN IF NOT EXISTS attachment_sha256 char(64),
  ADD COLUMN IF NOT EXISTS attachment_bytes bigint;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'drafts_attachment_consistency_check'
      AND conrelid = 'workoutreach.drafts'::regclass
  ) THEN
    ALTER TABLE drafts
      ADD CONSTRAINT drafts_attachment_consistency_check
      CHECK (
        (attachment_filename IS NULL AND attachment_mime_type IS NULL AND attachment_sha256 IS NULL AND attachment_bytes IS NULL)
        OR
        (attachment_filename IS NOT NULL AND attachment_mime_type = 'application/pdf' AND attachment_sha256 IS NOT NULL AND attachment_bytes > 0)
      );
  END IF;
END;
$$;

INSERT INTO schema_migrations (version) VALUES ('002_owner_campaign_stage_1')
ON CONFLICT DO NOTHING;

COMMIT;

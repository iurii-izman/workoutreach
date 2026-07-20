BEGIN;

SET search_path TO workoutreach, public;

ALTER TABLE contact_candidates
  ADD COLUMN IF NOT EXISTS provenance text NOT NULL DEFAULT 'published';

ALTER TABLE contact_candidates
  DROP CONSTRAINT IF EXISTS contact_candidates_category_check;
ALTER TABLE contact_candidates
  ADD CONSTRAINT contact_candidates_category_check CHECK (category IN (
    'general', 'sales', 'support', 'recruiting', 'privacy_or_legal',
    'personal_named', 'unknown', 'manual'
  ));

ALTER TABLE contact_candidates
  DROP CONSTRAINT IF EXISTS contact_candidates_provenance_check;
ALTER TABLE contact_candidates
  ADD CONSTRAINT contact_candidates_provenance_check
  CHECK (provenance IN ('published', 'manual'));

ALTER TABLE contact_candidates
  DROP CONSTRAINT IF EXISTS contact_candidates_manual_consistency_check;
ALTER TABLE contact_candidates
  ADD CONSTRAINT contact_candidates_manual_consistency_check CHECK (
    (provenance = 'published' AND category <> 'manual' AND source_id ~ '^p[0-9]{2}$')
    OR
    (provenance = 'manual' AND category = 'manual' AND source_id = 'manual' AND automatic_selection_allowed = false)
  );

CREATE TABLE IF NOT EXISTS contact_review_tokens (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  job_id text NOT NULL REFERENCES jobs(job_id) ON DELETE CASCADE,
  nonce_sha256 char(64) NOT NULL UNIQUE CHECK (nonce_sha256 ~ '^[0-9a-f]{64}$'),
  telegram_user_id bigint NOT NULL,
  telegram_chat_id bigint NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  invalidated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (expires_at > created_at),
  CHECK (consumed_at IS NULL OR consumed_at >= created_at),
  CHECK (invalidated_at IS NULL OR invalidated_at >= created_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS contact_review_tokens_one_active_job
  ON contact_review_tokens(job_id)
  WHERE consumed_at IS NULL AND invalidated_at IS NULL;

CREATE INDEX IF NOT EXISTS contact_candidates_review_idx
  ON contact_candidates(job_id, id);

INSERT INTO schema_migrations(version)
VALUES ('011_pilot_contact_resolution')
ON CONFLICT DO NOTHING;

COMMIT;

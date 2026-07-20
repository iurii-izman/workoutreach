BEGIN;

SET search_path TO workoutreach, public;

ALTER TABLE schema_migrations
  ADD COLUMN IF NOT EXISTS checksum_sha256 char(64);

ALTER TABLE schema_migrations
  DROP CONSTRAINT IF EXISTS schema_migrations_checksum_sha256_check;
ALTER TABLE schema_migrations
  ADD CONSTRAINT schema_migrations_checksum_sha256_check
  CHECK (checksum_sha256 IS NULL OR checksum_sha256 ~ '^[0-9a-f]{64}$');

INSERT INTO schema_migrations(version)
VALUES ('010_immutable_migration_registry')
ON CONFLICT DO NOTHING;

COMMIT;

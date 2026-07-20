#!/bin/sh
set -eu

export PGPASSWORD="$(cat /run/secrets/business_db_password)"

known_versions=""

emit_migration() {
  migration="$1"
  filename="$(basename "$migration")"
  version="${filename%.sql}"
  checksum="$(sha256sum "$migration" | awk '{print $1}')"

  if ! printf '%s' "$version" | grep -Eq '^[0-9]{3}_[a-z0-9_]+$'; then
    echo "Unsafe migration filename: $filename" >&2
    exit 2
  fi
  if [ "${#checksum}" -ne 64 ] || ! printf '%s' "$checksum" | grep -Eq '^[0-9a-f]{64}$'; then
    echo "Unable to calculate a safe migration checksum for $filename" >&2
    exit 2
  fi

  if [ -n "$known_versions" ]; then
    known_versions="$known_versions,"
  fi
  known_versions="${known_versions}'${version}'"

  printf "\\set migration_version '%s'\n" "$version"
  printf "\\set migration_checksum '%s'\n" "$checksum"
  cat <<SQL
SELECT to_regclass('workoutreach.schema_migrations') IS NOT NULL AS registry_exists \gset
\if :registry_exists
  SELECT EXISTS (
    SELECT 1 FROM workoutreach.schema_migrations WHERE version = :'migration_version'
  ) AS migration_applied \gset
\else
  \set migration_applied false
\endif
\if :migration_applied
  \echo 'Skipping applied migration' :migration_version
\else
  \echo 'Applying migration' :migration_version
  \i $migration
\endif
SELECT EXISTS (
  SELECT 1
  FROM information_schema.columns
  WHERE table_schema = 'workoutreach'
    AND table_name = 'schema_migrations'
    AND column_name = 'checksum_sha256'
) AS checksum_registry_exists \gset
\if :checksum_registry_exists
  UPDATE workoutreach.schema_migrations
  SET checksum_sha256 = :'migration_checksum'
  WHERE version = :'migration_version' AND checksum_sha256 IS NULL;
  SELECT COALESCE((
    SELECT checksum_sha256 = :'migration_checksum'
    FROM workoutreach.schema_migrations
    WHERE version = :'migration_version'
  ), false) AS checksum_matches \gset
  \if :checksum_matches
  \else
    \echo 'Migration checksum mismatch:' :migration_version
    \quit 3
  \endif
\endif
SQL
}

emit_checksum_verification() {
  migration="$1"
  version="$(basename "$migration" .sql)"
  checksum="$(sha256sum "$migration" | awk '{print $1}')"
  printf "\\set migration_version '%s'\n" "$version"
  printf "\\set migration_checksum '%s'\n" "$checksum"
  cat <<'SQL'
UPDATE workoutreach.schema_migrations
SET checksum_sha256 = :'migration_checksum'
WHERE version = :'migration_version' AND checksum_sha256 IS NULL;
SELECT COALESCE((
  SELECT checksum_sha256 = :'migration_checksum'
  FROM workoutreach.schema_migrations
  WHERE version = :'migration_version'
), false) AS checksum_matches \gset
\if :checksum_matches
\else
  \echo 'Migration checksum mismatch:' :migration_version
  \quit 3
\endif
SQL
}

{
  cat <<'SQL'
\set ON_ERROR_STOP on
SELECT pg_advisory_lock(hashtextextended('workoutreach-schema-migrations', 0));
SQL

  for migration in /workoutreach/migrations/*.sql; do
    emit_migration "$migration"
  done

  for migration in /workoutreach/migrations/*.sql; do
    emit_checksum_verification "$migration"
  done

  cat <<SQL
SELECT NOT EXISTS (
  SELECT 1
  FROM workoutreach.schema_migrations
  WHERE version <> ALL (ARRAY[$known_versions]::text[])
) AS registry_has_only_known_versions \gset
\if :registry_has_only_known_versions
\else
  \echo 'Database contains a migration version absent from this checkout'
  \quit 4
\endif
SELECT count(*) = cardinality(ARRAY[$known_versions]::text[])
       AND bool_and(checksum_sha256 IS NOT NULL)
       AS migration_registry_complete
FROM workoutreach.schema_migrations
WHERE version = ANY (ARRAY[$known_versions]::text[]) \gset
\if :migration_registry_complete
\else
  \echo 'Migration registry is incomplete'
  \quit 5
\endif
SELECT pg_advisory_unlock(hashtextextended('workoutreach-schema-migrations', 0));
SQL
} | psql --no-psqlrc --set=ON_ERROR_STOP=1 \
  --host=workoutreach-postgres \
  --username=workoutreach_app \
  --dbname=workoutreach_business

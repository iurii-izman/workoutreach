# ADR 0011: Immutable versioned migrations

Status: accepted — 2026-07-20

## Context

The original local migration container replayed every SQL file on every start. That made every historical migration responsible for permanent replay compatibility and allowed a repeated named constraint to interrupt dashboard setup after credentials had already been updated.

## Decision

- Serialize migration runs with a PostgreSQL session advisory lock.
- Treat `schema_migrations.version` as the execution boundary and skip versions already applied.
- Record the SHA-256 of every migration file after introducing the checksum registry.
- Refuse startup when an applied checksum differs from the file in the checkout or when the database contains a version absent from the checkout.
- Keep applied migrations immutable. Every later schema change is a new forward migration.
- Exercise a second no-op migration pass in Docker smoke and verify the restored checksum registry.

## Consequences

Repeated setup is deterministic and no longer replays historical DDL. Editing an applied migration, using an older checkout against a newer database, or restoring an incomplete registry becomes a typed deployment failure instead of an ambiguous partial upgrade.

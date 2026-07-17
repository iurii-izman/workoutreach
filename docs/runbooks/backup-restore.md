# Backup and restore

Stages 0–2 provide named volumes, separate n8n/business databases, pinned images, migration-only schema creation and a disposable business-database backup/restore smoke. Run it inside the Docker smoke lifecycle with `npm run smoke:backup-restore`; it restores into the explicitly named temporary database `workoutreach_restore_smoke`, verifies all migrations including Stage 2, and removes the temporary database and dump. This is technical restore evidence, not production backup readiness.

Before pilot, implement encrypted daily backups covering both PostgreSQL databases, the n8n data volume, and the exact `N8N_ENCRYPTION_KEY`. Store backup encryption material separately from the backup. Record target, retention and access control in an owner-approved ADR.

Restore verification must use a clean isolated Compose project, restore both databases and encryption material, start the pinned n8n image, and run read-only schema/workflow checks. Record timestamp, backup identifier, hashes, row-count checks and operator. A successful migration smoke test is not evidence of a successful backup restore.

# Backup and restore

Stage 0 provides named volumes, separate n8n/business databases, pinned images, and migration-only schema creation. It does not claim production backup readiness.

Before pilot, implement encrypted daily backups covering both PostgreSQL databases, the n8n data volume, and the exact `N8N_ENCRYPTION_KEY`. Store backup encryption material separately from the backup. Record target, retention and access control in an owner-approved ADR.

Restore verification must use a clean isolated Compose project, restore both databases and encryption material, start the pinned n8n image, and run read-only schema/workflow checks. Record timestamp, backup identifier, hashes, row-count checks and operator. A successful migration smoke test is not evidence of a successful backup restore.

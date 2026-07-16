# Rollback

Images and dependencies are pinned. Roll back by selecting a previously verified Git commit and its recorded container digests, running `npm ci --ignore-scripts`, then repeating preflight and smoke checks before switching traffic.

Database schema changes are forward-only. Do not manually edit production schema or blindly run destructive down migrations. A rollback that requires data transformation needs a new reviewed migration and restore point.

For stages 0–1, stopping the Compose project removes all runtime behavior; there is no email side effect to compensate.

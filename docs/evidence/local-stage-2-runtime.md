# Local Stage 2 runtime evidence

Date: 2026-07-17

Implemented and verified:

- pinned non-root bot image with read-only filesystem, dropped capabilities, no public port and Docker Secrets;
- one allowlisted Telegram long poller backed by PostgreSQL;
- migrations `004_local_stage_2_runtime` and `005_local_model_budget`;
- persisted update deduplication, evidence, contacts, immutable analyses/drafts and review actions;
- one-time hashed mock-send/regenerate/reject callbacks with ownership, TTL and replay protection;
- atomic UTC daily analysis reservation, default two analyses and exactly two model calls per analysis;
- process/store recovery and full bot container restart recovery;
- isolated disposable Docker smoke that cannot remove the running local project's volumes;
- backup/restore verification with all five migrations;
- mail transport disabled, send limit zero, kill switch enabled and mock-only outbox constraints.

Verification results:

- `npm run verify`: passed, 60/60 tests, secret/license/greenfield/workflow/eval/preflight/SBOM gates passed;
- isolated `npm run smoke:docker`: passed;
- Stage 2 DB replay/concurrency: exactly one mock outbox row;
- local DB smoke: two immutable draft versions, six immutable analysis rows and restart recovery passed;
- live local status after container restart: PostgreSQL, n8n, Caddy and bot healthy; migrations 004/005 present;
- live OpenAI calls during implementation and verification: zero;
- Telegram test messages during automated verification: zero;
- email transmissions: zero.

The runtime remains local. Telegram uses outbound long polling, PostgreSQL is not published, and Caddy binds only to loopback. A public domain/webhook and all Stage 3 mail/provider work remain deferred.

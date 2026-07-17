# Local Stage 2 runtime evidence

Date: 2026-07-17

Implemented and verified:

- pinned non-root bot image with read-only filesystem, dropped capabilities, no public port and Docker Secrets;
- one allowlisted Telegram long poller backed by PostgreSQL;
- migrations `004_local_stage_2_runtime`, `005_local_model_budget` and guarded SMTP migration `006_guarded_smtp_delivery`;
- persisted update deduplication, evidence, contacts, immutable analyses/drafts and review actions;
- one-time hashed mock-send/regenerate/reject callbacks with ownership, TTL and replay protection;
- atomic UTC daily analysis reservation, default two analyses and exactly two model calls per analysis;
- process/store recovery and full bot container restart recovery;
- isolated disposable Docker smoke that cannot remove the running local project's volumes;
- backup/restore verification with all six migrations;
- mail transport disabled, send limit zero, kill switch enabled and mock-only outbox constraints.

Verification results:

- `npm run verify`: passed, 62/62 tests, secret/license/greenfield/workflow/eval/preflight/SBOM gates passed;
- isolated `npm run smoke:docker`: passed;
- Stage 2 DB replay/concurrency: exactly one mock outbox row;
- local DB smoke: two immutable draft versions, six immutable analysis rows and restart recovery passed;
- live local status after container restart: PostgreSQL, n8n, Caddy and bot healthy; migrations 004/005 present;
- live OpenAI calls during implementation and verification: zero;
- Telegram test messages during automated verification: zero;
- email transmissions: zero.

Guarded SMTP foundation:

- authenticated SMTP submission on 465/587 with TLS 1.2+ and certificate validation;
- sender login, app password and sender address are Docker Secrets sourced from ignored `.env`;
- one-time approval, suppression, UTC daily limit 1–5 and at-most-once claim;
- no automatic retry after a claimed attempt;
- CV revalidated against its approved SHA-256 immediately before send;
- database approval/claim/replay/completion smoke passed with no network transmission;
- runtime remains disabled until owner mailbox configuration is supplied.

The runtime remains local. Telegram uses outbound long polling, PostgreSQL is not published, and Caddy binds only to loopback. A public domain/webhook and all Stage 3 mail/provider work remain deferred.

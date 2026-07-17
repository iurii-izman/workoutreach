# ADR-0006: Stage-2 database mock boundary

Status: accepted

## Context

Calibration quality work is intentionally paused, while approval, persistence, deduplication and operational safety can progress independently. The current local Telegram long-polling adapter is useful for Stage-1 review but holds job state in memory and must not be mistaken for the production n8n/PostgreSQL path.

## Decision

Stage 2 introduces a PostgreSQL-owned approval transaction and a mock-only outbox without activating mail or changing the local polling bot.

- PostgreSQL is the authority for approval tokens, operator actions, job transition, suppression and outbox uniqueness.
- The database generates a cryptographically random callback nonce, stores only its SHA-256 hash, caps TTL at 24 hours and consumes it in the same transaction that creates the outbox row.
- Recipient suppression uses an application-computed keyed HMAC. PostgreSQL receives only the fingerprint; the HMAC key is not stored in business tables.
- The outbox transport is constrained to `mock`, `provider_message_id` must remain null, the daily send limit is zero and the kill switch must remain enabled.
- Mock dispatch uses `FOR UPDATE SKIP LOCKED` and checks suppression again immediately before accepting the local mock command.
- n8n exports remain inactive and credential-free. They document the stored-function boundary but are not declared production-ready.
- The local bot remains Stage 1 until a persistent PostgreSQL credential, HTTPS webhook and connected n8n workflows are deployed and verified.

## Consequences

Replay and concurrent callback tests can prove exactly one outbox row without any external mail capability. A later mail-adapter migration must deliberately replace the database constraints; changing environment variables alone cannot enable sending. Stage 2 is not fully activated until the handoff checklist is complete.

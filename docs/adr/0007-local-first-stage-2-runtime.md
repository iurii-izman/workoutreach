# ADR-0007: Local-first Stage 2 runtime

Status: accepted

## Context

The owner wants a usable review workflow now, without paying for a server or domain. Stage 2 already has a PostgreSQL mock-only approval boundary. Telegram long polling can receive private allowlisted updates without exposing a local HTTP port, while PostgreSQL can replace the temporary in-memory state.

## Decision

- Activate Stage 2 as one Dockerized, allowlisted Telegram long-polling process backed by the business PostgreSQL database.
- Persist update deduplication, pages, contacts, analyses, immutable drafts, callback nonces, operator actions and the mock outbox in PostgreSQL.
- Keep n8n available locally for future orchestration, but do not make it the critical path of the local Stage 2 operator flow.
- Require migrations `004_local_stage_2_runtime` and `005_local_model_budget` before the bot becomes healthy.
- Reserve one daily analysis slot atomically before network access. One slot represents exactly two OpenAI Structured Output calls. The conservative local default is two slots per UTC day.
- Bind no bot or database port publicly. Caddy remains loopback-only; Telegram uses outbound `getUpdates` and API requests.
- Keep `LIVE_SEND_ENABLED=false`, `MAIL_TRANSPORT=disabled`, database daily send limit zero and the kill switch enabled. Approval creates only a local mock outbox record.
- A public HTTPS domain/webhook is optional future infrastructure for unattended remote hosting, not a Stage 2 requirement.

## Consequences

The owner can run the complete URL-to-review-to-mock workflow locally and survive container restarts without recurring hosting cost. Docker Desktop and the computer must be running for the bot to answer. Tests and smoke runs use fixtures/stubs and do not spend OpenAI credits; only an owner-submitted real URL invokes the model. A future webhook migration must stop long polling first and requires a separate ADR.

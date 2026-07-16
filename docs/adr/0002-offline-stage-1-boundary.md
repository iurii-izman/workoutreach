# ADR-0002: Offline stage-1 execution boundary

- Status: accepted
- Date: 2026-07-16
- Scope: stages 0 and 1 only

## Context

Owner materials, Telegram credentials, and an OpenAI test key are not yet provided. The contract permits explicitly non-sendable placeholders and deterministic model stubs, but forbids invented production copy and production secrets.

## Decision

Stage 1 has two adapters behind the same contracts:

1. a deterministic offline adapter used by CI and the evidence-producing dry-run;
2. a declarative n8n/OpenAI request contract that remains inactive until credentials and owner materials are supplied.

The offline adapter reads only synthetic fixtures with provenance. Telegram output is rendered as a complete preview payload but is not transmitted. The `send` action is a mock refusal and there is no mail transport or outbox implementation in stages 0–1.

Product offer and email files are conspicuously marked non-sendable. A `READY_FOR_REVIEW` example is possible only with the synthetic eval offer profile supplied by its fixture.

## Consequences

The dry-run proves deterministic gates and preview composition, not live OpenAI or Telegram connectivity. Enabling either requires explicit credentials, a separate manual eval, and owner-approved content. Mail delivery remains out of scope.

# ADR 0016: Fixed universal active runtime

Status: accepted — 2026-08-05

## Context

The owner has frozen company-specific personalization for the next operating period. Every recipient now receives the same owner-approved Russian subject and body, while the active workflow still needs deterministic public-contact discovery, provenance, suppression, immutable review, explicit approval, at-most-once SMTP dispatch and dashboard history. Calling a model or exposing an OpenAI credential to the bot would add cost and failure modes without changing the approved content.

The owner is considering a corpus of about 500 partner contacts. A personal Gmail mailbox, rapid unsolicited batch dispatch and unreviewed external contact lists are not a reliable or policy-safe scaling path. Acquisition and delivery must remain separate responsibilities.

## Decision

- Activate `email-ru-career-v3`, a byte-stable subject and body with zero dynamic placeholders.
- Hard-code the Docker bot to `OUTREACH_PERSONALIZATION_MODE=off`; do not mount the OpenAI API key or require an OpenAI runtime check.
- Retain the versioned personalization code, prompts and schemas only as frozen, inactive evaluation material. The production Telegram path cannot enable them through `.env`.
- Keep URL safety, bounded crawl, published-email provenance, manual-contact labelling, deduplication, suppression, CV validation, immutable draft storage, explicit per-message approval, SMTP idempotency and dashboard recording unchanged.
- Do not issue a regeneration action for a fixed universal draft.
- Keep the owner-approved SMTP ceiling at 30 accepted messages per UTC day and do not add automatic batch sending.
- Treat a future CSV flow as staging only: every row must carry a normalized email, company/site key and owner-verifiable provenance; import must not create approvals or outbox rows. It requires a separate ADR and provider/legal review before implementation.

## Consequences

The active URL flow uses zero model calls and the bot container has no OpenAI credential. Draft generation becomes deterministic and cheaper, while contact discovery and delivery safeguards remain intact. Processing a large target corpus can be prepared independently, but 500 messages cannot be compressed into a few days through the current 30/day Gmail SMTP boundary.

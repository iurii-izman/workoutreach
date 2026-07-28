# ADR 0015: Universal-first personalization resilience

Status: accepted — 2026-07-28

## Context

The pilot produced heterogeneous safe-stop codes, while one formatting defect in an otherwise optional company-specific phrase discarded the complete draft and consumed the model budget. The owner plans a reviewed 50+ target campaign and approved a concise universal opening that remains useful without a company claim.

## Decision

- Introduce owner-approved email template v2 with one `OPENING_PARAGRAPH` placeholder and a generic subject.
- Use the exact universal opening as the safe baseline; do not synthesize a fallback company fact.
- Make `optional` personalization the production default, retain `off` and `required` modes for deterministic operation and evaluation.
- Keep URL, robots, contact provenance, attachment, suppression, approval, idempotency and SMTP gates fail-closed.
- Allow only deterministic removal of surrounding quotes or addition of a missing terminal mark.
- Allow one phrase-only regeneration for sentence-count, word-count or agreement failures. A second failure produces an operator-visible universal draft.
- Persist the verified fact stage independently. Regeneration and `/retry` may reuse it only after validating it against freshly loaded pages.
- Use `gpt-5.6-luna` for the fact and phrase roles at explicit `low` effort while retaining strict Responses API Structured Outputs, `store=false`, no tools and existing cache policy.
- Count all phrase attempts in safe usage metadata and cap one draft version at three model calls.

## Consequences

Model or phrase-format failures no longer erase a safe, useful draft. Universal-only processing uses no model budget. Personalization remains visibly distinguishable in Telegram and can never inject an unverified company claim into the fallback. The provider remains OpenAI; a separate provider adapter requires its own ADR and representative eval.

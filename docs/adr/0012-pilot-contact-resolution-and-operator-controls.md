# ADR 0012: Pilot contact resolution and operator controls

Status: accepted — 2026-07-20

## Context

The pre-pilot runtime stopped safely when a site exposed several eligible email addresses or no eligible address, but it did not preserve a durable owner decision path. The owner also needs bounded queue and usage visibility before evaluating up to 50 companies. Running the same responsibility in both Node.js and n8n would create competing state and send paths.

## Decision

- Keep the hardened Node.js bot as the only active crawl, analysis, approval and SMTP path; keep all n8n workflow exports inactive.
- Persist pre-model pages and contact candidates in PostgreSQL. `NEEDS_CONTACT` and `NEEDS_REVIEW` consume zero OpenAI calls.
- Show published candidate email, deterministic category and source URL in Telegram. Protected categories remain visible for context but cannot be selected.
- Put only job ID, database candidate ID and a random nonce in callback data. Store only the nonce SHA-256, bind it to the allowlisted user/chat and expire/consume it atomically.
- Re-crawl after a published choice and require the selected address to remain literally present and policy-eligible before model calls.
- Accept a known manual address only through `/email <job_id> <address>` for an active contact-review job. Store `category=manual` and `provenance=manual`; never pass the address to the model.
- Add PostgreSQL-backed `/next`, `/queue` and `/usage`. These commands inspect state and cannot approve or send.

## Consequences

Contact ambiguity becomes a durable human decision rather than a failed job, without spending model credits. Callback replay and ownership are auditable. Manual addresses are explicit and distinguishable from published evidence. n8n remains available for later measured orchestration work but does not duplicate the critical path.

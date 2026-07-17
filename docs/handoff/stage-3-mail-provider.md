# Owner and developer handoff: Stage 3 mail provider

Do not begin this checklist until Stage 2 is fully activated and independently accepted. This stage cannot be completed responsibly from repository code alone.

## Owner decisions and evidence required first

1. Sender domain and mailbox owned by the operator.
2. Target countries and recipient categories for the pilot.
3. Written legal/compliance conclusion for individualized career outreach and retention.
4. Written confirmation that the selected provider permits this exact use case; generic account availability is not approval.
5. Reply handling owner, opt-out handling SLA and permanent suppression policy.
6. Production host, backup target, encryption owner and incident contact.

Do not send provider passwords, OAuth refresh tokens or DNS-provider credentials through chat or commit them to Git.

## Developer implementation after owner approval

1. Write an ADR naming exactly one transport and documenting its AUP/ToS evidence, OAuth scopes, rate limits, event model and ambiguous-timeout behavior.
2. Implement a narrow mailbox adapter interface. It receives an already-approved immutable outbox row and may not call OpenAI, crawl websites or alter a draft.
3. Introduce a new migration that deliberately relaxes the Stage-2 mock constraints. Require a separate production preflight flag and kill switch; environment changes alone must not bypass the migration gate.
4. Store credentials only in the provider-specific n8n credential store or Docker Secrets. Keep credential identifiers and values out of exports and logs.
5. Configure SPF, DKIM and DMARC monitoring for the exact sender domain; record DNS readback evidence without exposing unrelated DNS data.
6. Re-check suppression in the same transaction that claims a live send. Enforce a database-backed daily limit initially capped at owner-approved 5–10 messages.
7. Use one stable idempotency key per `(job_id, draft_version)`. Persist the provider message ID when available.
8. Treat a timeout after request transmission as ambiguous. Do not auto-retry until provider state is reconciled.
9. Verify signed webhook events from raw request bytes, deduplicate provider event IDs and normalize only the event names defined in the technical specification.
10. Implement immediate unsubscribe/complaint/permanent-bounce suppression and a reply runbook. Never describe provider acceptance as inbox delivery.
11. Test only with addresses controlled by the owner. Keep all real target-company addresses blocked until explicit pilot authorization.
12. Run rollback and kill-switch drills, encrypted backup/restore, credential rotation and least-privilege review.

## Stage-3 acceptance evidence

- provider-policy approval and legal scope recorded;
- sender-domain SPF/DKIM/DMARC readback;
- OAuth scope and secret-storage review;
- owner-controlled test messages only;
- duplicate/timeout/event-replay tests;
- suppression and daily-limit tests;
- backup/restore and kill-switch drill;
- owner’s explicit written authorization before any external pilot.

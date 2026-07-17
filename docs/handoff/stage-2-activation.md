# Developer handoff: activate Stage 2 without enabling mail

This checklist is the next engineering task after the verified database foundation. It does not depend on adding more calibration sites, but it must preserve all current phrase/evidence gates.

## Goal

Replace the temporary in-memory operator state with a persistent n8n/PostgreSQL review path while keeping email physically impossible. A successful result is: URL → current guarded analysis → immutable draft in PostgreSQL → one-time Telegram buttons → atomic mock outbox → precise `email not sent` status after restart/replay.

## Preconditions supplied by the owner

- a persistent deployment host and HTTPS domain for n8n;
- confirmation that the existing private Telegram bot will become the webhook bot;
- a maintenance window to stop the local long-polling process before setting the webhook;
- backup location and encryption mechanism for production-like data.

No mail provider, sender password or OAuth grant is needed or allowed for this task.

## Implementation sequence

1. Start the pinned Compose stack persistently; do not use `smoke:docker`, because that command intentionally destroys its disposable volumes.
2. Run all migrations through `workoutreach-migrate`. Never edit the production schema manually.
3. Create one n8n PostgreSQL credential for `workoutreach_app` against `workoutreach_business`. Keep the credential ID only in n8n metadata; workflow exports must remain credential-free.
4. Populate `operator_allowlist` from the ignored owner allowlist. Do not place IDs in Git, workflow JSON or logs.
5. Convert the tracked workflow contracts into connected inactive workflows. Keep the reviewed logic in versioned source under `n8n/code/lib/`; do not maintain an untested second copy in Code nodes.
6. Persist each accepted pipeline result transactionally: job, loaded page evidence, contact candidates, immutable analyses, selected contact fingerprint and immutable draft. Raw HTML remains memory-only.
7. Compute `recipient_hmac` outside PostgreSQL using `recipientFingerprint()` and a 32-byte-or-longer secret from Docker Secrets. Never store the key or raw email in suppression/audit metadata.
8. Call `issue_mock_approval_token()` only after the job reaches `DRAFT_READY`. Use the returned callback data once in the final Telegram preview message. Never store or log the raw nonce.
9. On callback, immediately call `answerCallbackQuery`, validate user/chat allowlist, then call `handle_mock_send_callback()` with an idempotency key derived only from Telegram `update_id`.
10. Show exact result text: `MOCK_OUTBOX_CREATED` means saved locally; `MOCK_ACCEPTED` means processed by the local mock worker; both must explicitly state that no email was sent.
11. Connect the inactive `05_mock_dispatch` schedule to `dispatch_next_mock_outbox()`. It must contain no SMTP, Gmail, Outlook, generic HTTP-request or community node.
12. Implement `/status <job_id>`, `/cancel <job_id>` and restart recovery from PostgreSQL. Authorization must be checked on every read and mutation.
13. Add DB-backed reject and regenerate actions with one-time nonces. Regenerate may create draft versions 2 and 3 only; every version remains immutable. Contact selection must create a new draft, never update an old draft.
14. Before setting a webhook, stop the local poller with `npm run bot:stop`; verify `getWebhookInfo` has no competing webhook, then configure the HTTPS webhook with Telegram secret-token verification.
15. Keep all workflows inactive until the clean-clone, verification, Docker smoke and a dedicated restart/replay test pass.

## Required tests

- unauthorized user and chat independently rejected;
- duplicate Telegram update creates no second job;
- expired, invalid, consumed and wrong-owner nonce rejected;
- two concurrent approvals create exactly one operator action and one outbox row;
- suppression inserted after approval but before dispatch blocks dispatch;
- process and container restarts preserve job, draft, nonce and action state;
- draft/contact versioning remains immutable;
- webhook replay and out-of-order update handling are idempotent;
- no success log or Telegram text claims provider or inbox delivery;
- repository/workflow secret scan remains green;
- `MAIL_TRANSPORT=disabled`, `LIVE_SEND_ENABLED=false`, daily limit zero and database mock constraints remain unchanged.

## Acceptance gate

Stage 2 may be marked fully active only when the owner can complete the flow through Telegram after a full container restart, repeated/concurrent clicks still yield one mock row, and the runtime has no mail credential or external transmission node. Commit evidence must include sanitized workflow exports, test counts, migration list, restart/replay results and `mail_transmitted=false`.

## Work deliberately deferred

Mailbox adapter selection, SPF/DKIM/DMARC, provider events, unsubscribe endpoint, production daily limits and any real send belong to Stage 3. The exact owner/developer checklist for that stage is in `docs/handoff/stage-3-mail-provider.md`.

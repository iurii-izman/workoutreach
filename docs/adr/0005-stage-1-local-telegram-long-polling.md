# ADR-0005: Stage-1 local Telegram long polling

- Status: Accepted
- Date: 2026-07-17

## Context

The owner asked for the Telegram test bot to become interactive before a production host and public HTTPS webhook domain are selected. Telegram permits either `getUpdates` long polling or a webhook, but not both. The bot currently has no webhook, and all live email capabilities remain intentionally absent.

## Decision

1. Stage 1 may run one local hidden long-polling process for the allowlisted private test chat.
2. The bot offers `/start`, `/help`, `/status` and `/version`, accepts exactly one public URL, acknowledges the job, shows a typing indicator, runs guarded live analysis and returns the complete preview.
3. `update_id + 1` is persisted as the next offset under ignored `.runtime/`; a single-process lock prevents competing pollers. A heartbeat and redacted event logs support local health checks.
4. User ID and chat ID must both be allowlisted. Unauthorized updates are acknowledged at the polling layer but receive no company or campaign data.
5. Every inline callback is answered immediately. `Отправить` always returns `MOCK_SEND_BLOCKED`; `Отклонить` removes the keyboard; `Перегенерировать` requires an existing in-memory review job and is limited to two explicit attempts.
6. The public bot profile, Russian descriptions, command menu and command list are configured through the Bot API and read back after writing.
7. The bot process never receives mail credentials, cannot create an outbox and refuses to start unless `MAIL_TRANSPORT=disabled` and `LIVE_SEND_ENABLED=false`.
8. This is a local Stage-1 adapter. Production migration still requires PostgreSQL-backed workflow state, n8n orchestration and an HTTPS webhook with secret-token verification.

## Consequences

- The owner can use the bot immediately without exposing a local port or deploying a public webhook.
- Restarting the process preserves the Telegram offset but not completed in-memory regeneration context; an old regeneration button safely asks the owner to resend the URL.
- Only one polling process may use the token. Credential discovery no longer calls `getUpdates` after the allowlist is configured, preventing poll conflicts.
- A later webhook activation must first stop the polling process and be recorded in a separate deployment decision.

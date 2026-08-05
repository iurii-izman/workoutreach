# Telegram test-bot runbook

## Safety prerequisites

- `.env` is ignored and contains a valid Telegram credential, one user/chat allowlist and the validated external CV configuration.
- `OUTREACH_PERSONALIZATION_MODE=off` and `TELEGRAM_MODE=live-preview`.
- `MAIL_TRANSPORT=disabled` and `LIVE_SEND_ENABLED=false`.
- Telegram webhook URL is empty.

## Configure profile

```powershell
npm run bot:configure
```

This idempotently sets and reads back the bot name, Russian descriptions, `/start`, `/help`, `/status`, `/version`, and the commands menu.

## Start, inspect and stop

```powershell
npm run bot:start
npm run bot:status
npm run bot:stop
```

`bot:start` launches a hidden local Node.js process. Runtime lock, offset, heartbeat and redacted logs live under ignored `.runtime/`. `bot:status` is healthy only when the process is alive and the heartbeat is at most 45 seconds old.

## Operator flow

1. Send one public company URL as the whole Telegram message.
2. Wait for `Принято · #WO-...` and the typing indicator.
3. Review the recipient, contact source, attachment status and full fixed email.
4. Use `Отклонить` if the recipient is unsuitable; the fixed letter has no regeneration action.
5. `Отправить` only displays the Stage-1 block and cannot transmit email.

## Troubleshooting

- `BOT_ALREADY_RUNNING`: use `npm run bot:status`; do not start a second poller.
- `TELEGRAM_WEBHOOK_CONFLICT`: stop and investigate the webhook before changing modes.
- `TELEGRAM_API_ERROR` with conflict: another `getUpdates` process is using the token.
- `degraded` heartbeat: inspect `.runtime/telegram-bot.stderr.log`; logs contain safe codes, not tokens or raw API payloads.
- Old regeneration buttons belong to historical personalized drafts and are not issued for new universal-only jobs.

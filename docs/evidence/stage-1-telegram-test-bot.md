# Stage 1 Telegram test-bot evidence

Date: 2026-07-17

## Public Bot API configuration

- Bot display name set to `Workoutreach · Bitrix24`.
- Default and Russian descriptions configured and read back successfully.
- Default and Russian command menus contain `/start`, `/help`, `/status`, `/version`.
- Private-chat menu button is `commands`.
- Webhook URL is empty; update mode is one local allowlisted long-polling process.

## Runtime evidence

- Hidden local process started successfully.
- Process lock, persisted Telegram offset, heartbeat and redacted event logs are under ignored `.runtime/`.
- Health check reported `running`, live process and fresh heartbeat.
- The allowlisted owner `/start` update was received and answered end-to-end.
- A separate ready notification was transmitted to the same allowlisted chat.
- No raw update, token, API key, user ID or chat ID was written to tracked files or safe logs.

## Safety and tests

- 49/49 tests passed, including allowlist, commands, URL flow, callback acknowledgement, mock-send block, explicit regeneration limit, evidence boundaries and unauthorized update handling.
- Full repository `npm run verify` passed while the bot was running.
- A fresh guarded live evaluation passed after the language fix: the 27-word phrase used correct plural agreement (`настройка и техническая поддержка … пересекаются`) and no Telegram/email transmission was requested by that check.
- Docker smoke again imported all five inactive workflows, applied both migrations and removed its containers, networks and volumes.
- `MAIL_TRANSPORT=disabled`, `LIVE_SEND_ENABLED=false`, outbox absent.
- The bot cannot send email; the `Отправить` callback only displays the physical Stage-1 block.

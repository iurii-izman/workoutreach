# Incident and kill switch

The default kill switch is structural: `LIVE_SEND_ENABLED=false`, `MAIL_TRANSPORT=disabled`, daily limit zero, database `kill_switch_enabled=true` and disabled workflows. The SMTP adapter and owner-approved template exist, but cannot create or claim an SMTP outbox while these runtime controls are disabled.

If an unexpected external action or secret exposure is suspected:

1. run `npm run gmail:disable`; this disables the database SMTP switch and restarts the bot in mail-disabled mode;
2. if the command cannot complete, run `docker compose stop workoutreach-bot` immediately;
3. revoke the Gmail app password or other affected provider credential in its provider console;
4. preserve only redacted logs correlated by `job_id`; n8n is not the current send path;
5. rotate the affected secret class and run greenfield/secret scans plus the non-sending verification suite;
6. document scope, timeline, affected records and recovery evidence before restart.

Never paste raw payloads, HTML, tokens, email content or stack traces into Telegram.

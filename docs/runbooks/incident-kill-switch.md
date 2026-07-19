# Incident and kill switch

The default kill switch is structural: `LIVE_SEND_ENABLED=false`, `MAIL_TRANSPORT=disabled`, daily limit zero, database `kill_switch_enabled=true` and disabled workflows. The SMTP adapter and owner-approved template exist, but cannot create or claim an SMTP outbox while these runtime controls are disabled.

If an unexpected external action or secret exposure is suspected:

1. stop the n8n container;
2. revoke affected provider credentials from their provider consoles;
3. preserve only redacted logs correlated by job/execution ID;
4. rotate the affected secret class;
5. run greenfield and secret scans;
6. document scope, timeline, affected records and recovery evidence before restart.

Never paste raw payloads, HTML, tokens, email content or stack traces into Telegram.

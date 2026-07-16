# Incident and kill switch

Current kill switch is structural: `LIVE_SEND_ENABLED=false`, `MAIL_TRANSPORT=disabled`, no outbox, no mail adapter, disabled workflows and non-sendable templates.

If an unexpected external action or secret exposure is suspected:

1. stop the n8n container;
2. revoke affected provider credentials from their provider consoles;
3. preserve only redacted logs correlated by job/execution ID;
4. rotate the affected secret class;
5. run greenfield and secret scans;
6. document scope, timeline, affected records and recovery evidence before restart.

Never paste raw payloads, HTML, tokens, email content or stack traces into Telegram.

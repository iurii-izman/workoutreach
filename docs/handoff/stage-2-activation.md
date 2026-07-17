# Stage 2 activation handoff

Local Stage 2 is implemented through ADR-0007. A persistent server, public HTTPS domain and Telegram webhook are not prerequisites.

## Implemented path

URL → allowlisted Telegram long polling → safe crawl/contact extraction → two guarded Structured Output calls → literal/business gates → PostgreSQL evidence and immutable draft → one-time review buttons → atomic mock outbox.

The runtime provides update deduplication, restart recovery, draft versions 1–3, ownership checks, one-time hashed callback tokens, daily model-budget reservation and exact mock status. It contains no SMTP/OAuth/mail adapter, and no environment change alone can make the database outbox sendable.

## Acceptance checklist

- `npm run verify` and the isolated Docker smoke pass without live OpenAI calls;
- migrations 001–005 are present;
- `npm run local:start` and `npm run local:status` report a healthy local PostgreSQL-backed bot;
- a container restart preserves persisted state;
- repeated/concurrent approval yields one mock outbox row;
- `LIVE_SEND_ENABLED=false`, `MAIL_TRANSPORT=disabled`, send limit zero and kill switch enabled;
- bot/database have no public inbound port and Telegram webhook is absent;
- tests and logs contain no credentials, allowlist identifiers, CV path/hash or raw callback nonce.

## Deferred work

Connecting the inactive n8n workflow contracts to a public webhook is optional and requires a new deployment decision, domain, TLS, webhook secret verification and stopping the poller first. Mail provider selection, corporate sender domain, SPF/DKIM/DMARC, provider events, legal approval and any real send remain Stage 3 work.

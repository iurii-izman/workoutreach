# Local Stage 2 runbook

## Start and inspect

Docker Desktop must be running. Secrets remain in ignored `.env` and `.secrets/`; the CV is mounted read-only and never copied into the image.

```powershell
npm run local:start
npm run local:status
```

A healthy status requires PostgreSQL, n8n, Caddy, dashboard and the bot to be healthy, migrations 004–011 to exist, no public Telegram webhook and no public PostgreSQL port. Caddy listens only on `127.0.0.1:443`. Do not run a second poller for the same bot token. n8n remains an inactive visual/orchestration layer; the Node.js bot is the only active analysis/send path.

## Credit guard

`DAILY_ANALYSIS_LIMIT=40` allows at most forty new analyses per UTC day. Each accepted analysis reserves exactly two OpenAI requests immediately before the first model call. Contact-only stops (`NEEDS_CONTACT`/`NEEDS_REVIEW`) reserve nothing. Repeated Telegram updates do not reserve twice; failed/reserved model work still counts conservatively for that day. `LOCAL_OPENAI_MAX_OUTPUT_TOKENS=1200` is the per-call local output ceiling. Use `/usage` for current UTC-day counters.

## Operator commands and contact resolution

- `/next` — oldest active job that needs an operator decision;
- `/queue` — bounded actionable queue and counts by state;
- `/usage` — model and SMTP counters without guessed cost;
- `/email WO-XXXXXX name@example.com` — explicit known address only for `NEEDS_CONTACT`/`NEEDS_REVIEW`;
- `/status WO-XXXXXX` and `/approve WO-XXXXXX` — inspect and reopen approval for an immutable ready draft.

For several published addresses, verify category and source URL before using a button. Protected categories are visible but not selectable. A button contains only candidate ID and a hashed one-time-token counterpart; the site is crawled again and the address must still be literally present before OpenAI runs. A manual address is visibly/audit-marked `manual`, is never guessed and is not sent to the model.

Automated tests, `npm run verify` and Docker smoke use fixtures/stubs and make zero live OpenAI requests. Credits are spent only after the allowlisted owner sends a valid company URL to the running bot.

## Restart and stop

```powershell
docker restart workoutreach-bot
npm run local:status
npm run local:stop
```

`local:stop` preserves named volumes. The bot has `restart: unless-stopped`; for recovery after Windows login, enable Docker Desktop startup in Docker Desktop settings. A stopped PC cannot answer Telegram.

## Safety response

If status is unhealthy, stop the bot and inspect sanitized container logs without copying secrets into tickets. In repository-default/CI mode, `Отправить (mock)` must report that email was not sent and create at most one mock row. In an owner-activated SMTP runtime, every company message still needs its own one-time Telegram confirmation. Use the incident kill-switch runbook for any unexpected external behavior.

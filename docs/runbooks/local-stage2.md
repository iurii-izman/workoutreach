# Local Stage 2 runbook

## Start and inspect

Docker Desktop must be running. Secrets remain in ignored `.env` and `.secrets/`; the CV is mounted read-only and never copied into the image.

```powershell
npm run local:start
npm run local:status
```

A healthy status requires PostgreSQL, n8n, Caddy, dashboard and the bot to be healthy, migrations 004–012 to exist, no public Telegram webhook and no public PostgreSQL port. Caddy listens only on `127.0.0.1:443`. Do not run a second poller for the same bot token. n8n remains an inactive visual/orchestration layer; the Node.js bot is the only active analysis/send path.

## Universal-only cost boundary

The active bot is hard-coded to `OUTREACH_PERSONALIZATION_MODE=off`, receives no OpenAI secret and makes zero model calls. `/usage` remains useful for SMTP acceptance and queue counters; its model counters must stay at zero for new universal-only work.

## Operator commands and contact resolution

- `/next` — oldest active job that needs an operator decision;
- `/queue` — bounded actionable queue and counts by state;
- `/usage` — zero-model and SMTP counters without guessed delivery status;
- `/email WO-XXXXXX name@example.com` — explicit known address only for `NEEDS_CONTACT`/`NEEDS_REVIEW`;
- `/status WO-XXXXXX` and `/approve WO-XXXXXX` — inspect and reopen approval for an immutable ready draft.

For several published addresses, verify category and source URL before using a button. Protected categories are visible but not selectable. A button contains only candidate ID and a hashed one-time-token counterpart; the site is crawled again and the address must still be literally present before the fixed draft is created. A manual address is visibly/audit-marked `manual` and is never guessed.

Automated tests, `npm run verify`, Docker smoke and the active bot make zero OpenAI requests.

## Restart and stop

```powershell
docker restart workoutreach-bot
npm run local:status
npm run local:stop
```

`local:stop` preserves named volumes. The bot has `restart: unless-stopped`; for recovery after Windows login, enable Docker Desktop startup in Docker Desktop settings. A stopped PC cannot answer Telegram.

## Safety response

If status is unhealthy, stop the bot and inspect sanitized container logs without copying secrets into tickets. In repository-default/CI mode, `Отправить (mock)` must report that email was not sent and create at most one mock row. In an owner-activated SMTP runtime, every company message still needs its own one-time Telegram confirmation. Use the incident kill-switch runbook for any unexpected external behavior.

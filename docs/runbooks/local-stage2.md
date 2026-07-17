# Local Stage 2 runbook

## Start and inspect

Docker Desktop must be running. Secrets remain in ignored `.env` and `.secrets/`; the CV is mounted read-only and never copied into the image.

```powershell
npm run local:start
npm run local:status
```

A healthy status requires PostgreSQL, n8n and the bot to be healthy, migrations 004/005 to exist, no public Telegram webhook and no public PostgreSQL port. Caddy listens only on `127.0.0.1:443`. Do not run a second poller for the same bot token.

## Credit guard

`DAILY_ANALYSIS_LIMIT=2` allows at most two new analyses per UTC day. Each accepted analysis reserves exactly two OpenAI requests before either request begins. Lower the ignored `.env` value to `1` for single-site calibration. Repeated Telegram updates do not reserve twice; failed/reserved work still counts conservatively for that day. `LOCAL_OPENAI_MAX_OUTPUT_TOKENS=1200` is the local output ceiling.

Automated tests, `npm run verify` and Docker smoke use fixtures/stubs and make zero live OpenAI requests. Credits are spent only after the allowlisted owner sends a valid company URL to the running bot.

## Restart and stop

```powershell
docker restart workoutreach-bot
npm run local:status
npm run local:stop
```

`local:stop` preserves named volumes. The bot has `restart: unless-stopped`; for recovery after Windows login, enable Docker Desktop startup in Docker Desktop settings. A stopped PC cannot answer Telegram.

## Safety response

If status is unhealthy, stop the bot and inspect sanitized container logs without copying secrets into tickets. Never add a mail credential. `Отправить (mock)` must report that email was not sent and must create at most one mock row. Use the incident kill-switch runbook for any unexpected external behavior.

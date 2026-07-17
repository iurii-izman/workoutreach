# Stage-2 mock outbox runbook

## Safety meaning

`MOCK_OUTBOX_CREATED` means only that an allowlisted operator action was committed to PostgreSQL. `MOCK_ACCEPTED` means only that the local mock dispatcher claimed that row. Neither status means an email was transmitted, accepted by a provider, accepted by an MX, delivered to an inbox or read.

The schema physically enforces `transport = 'mock'`, a null provider message ID, live send disabled, mail transport disabled, daily limit zero and kill switch enabled.

## Verification

Run the complete disposable environment:

```powershell
npm run smoke:docker
```

The smoke test creates only synthetic `.example` records and verifies:

1. identical callback replay returns the same result and one outbox row;
2. two concurrent executions of the same callback return one stable result and one outbox row;
3. a suppressed fingerprint cannot create an outbox row;
4. dispatch checks suppression again;
5. a second dispatcher run has no work;
6. no provider message ID or non-mock transport can be stored;
7. a custom-format backup restores into a clean temporary database.

Evidence is written under ignored `artifacts/evidence/`. The smoke command removes its containers and volumes at completion.

## Incident response

If any assertion fails, keep n8n workflows inactive, keep `LIVE_SEND_ENABLED=false`, stop the local bot only if Telegram behavior is involved, collect safe error codes without payloads, and do not manually mutate business tables. Correct the migration or stored function and rerun from a clean disposable volume.

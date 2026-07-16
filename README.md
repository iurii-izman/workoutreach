# Workoutreach

Workoutreach is a strict-greenfield, human-reviewed outreach prototype. This repository currently implements only stages 0 and 1: reproducible bootstrap plus an offline dry-run that ends at a complete Telegram preview. It cannot send email.

`TECHNICAL_SPEC.md` is the contract. `AGENTS.md` defines the durable repository isolation and safety policy.

## Current safety state

- OpenAI: deterministic stub; Responses API and strict JSON Schema contracts are prepared but inactive.
- Telegram: rendered preview stub; no token and no network transmission.
- Mail: disabled; no adapter, outbox, or credentials.
- Templates and product offer: explicit non-sendable owner placeholders.
- Test data: synthetic `.example` fixtures with documented provenance and no PII.

## Prerequisites

- Node.js 24 or newer;
- npm 11 or newer;
- Docker Desktop with Compose for the optional infrastructure smoke test.

## Verify stages 0–1

```powershell
npm ci --ignore-scripts
npm run verify
npm run dry-run
```

The dry-run prints the complete Russian Telegram review payload and writes machine-readable evidence to `artifacts/evidence/dry-run.json`. The aggregate gate report is `artifacts/evidence/verification.json`. Runtime artifacts are ignored by Git.

For a clean infrastructure start, migration and HTTPS health check:

```powershell
npm run smoke:docker
```

This command generates ephemeral development-only secret files under ignored `.secrets/`, starts only the pinned Workoutreach Compose project, applies migrations, queries migration evidence, then removes its test containers and volumes.

For a committed clean-clone reproduction entirely below this repository root:

```powershell
npm run smoke:clean-clone
```

## Layout

- `n8n/code/lib/` — testable deterministic pipeline logic;
- `n8n/workflows/` — sanitized, inactive, credential-free workflow contracts;
- `schemas/` and `prompts/` — canonical model contracts;
- `templates/` and `product/` — versioned, currently non-sendable owner placeholders;
- `migrations/` — PostgreSQL business-state schema;
- `fixtures/` — synthetic source/model/offer evidence;
- `scripts/` — preflight, scans, SBOM, workflow validation and smoke commands;
- `docs/adr/` and `docs/runbooks/` — decisions and operating procedures.

## Intentionally blocked

Do not add real keys merely to make CI green. Live OpenAI evaluation requires a test key and an owner-approved eval budget. A Telegram test bot requires a secret-channel token and explicit test user/chat allowlist. Production copy, mailbox provider, legal scope, retention deviations, and production host are still owner inputs.

Stages 2–5 are not implemented. In particular, there is no real approval token, suppression list, outbox, mail adapter, provider event processing, or live pilot path.

Tracked workflow exports intentionally contain no n8n instance IDs. `scripts/prepare-workflow-import.mjs` creates ignored deterministic import copies because the pinned n8n CLI requires a workflow ID at database import time.

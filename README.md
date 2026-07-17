# Workoutreach

Workoutreach is a strict-greenfield, human-reviewed career-outreach prototype for Bitrix24 integrators. Stages 0 and 1 provide a reproducible bootstrap, deterministic offline dry-run and an explicit single-company guarded live evaluation. The Stage-2 database foundation adds atomic one-time approval, suppression and a physically mock-only outbox. It cannot send email.

`TECHNICAL_SPEC.md` is the contract. `AGENTS.md` defines the durable repository isolation and safety policy.

## Current safety state

- OpenAI: deterministic stub in CI/default dry-run; an explicit `live:preview` uses the Responses API with strict Structured Outputs, `store=false` and no tools.
- Telegram: stub by default; an explicit `--telegram` may send only the preview to an allowlisted test chat.
- Mail: disabled; no adapter or credentials. The database has a mock-only outbox whose constraints prohibit provider IDs and live transport.
- Template and candidate profile: owner-approved, versioned and still `sendable=false`; only company name and personalization phrase are dynamic.
- CV: external read-only PDF validated by filename, signature, size and SHA-256; never tracked or provided to the model.
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

## Local secret setup and guarded live preview

`.env` is ignored. It may contain `OPENAI_API_KEY`, `TELEGRAM_BOT_TOKEN`, the external CV path/hash and non-secret allowlists. Verify them without a billed model call:

```powershell
npm run credentials:check
```

To populate the allowlist, send `/start` to the test bot from the intended private Telegram account, then run:

```powershell
npm run credentials:allowlist
```

Run exactly one company through live OpenAI analysis without transmitting the preview:

```powershell
npm run live:preview -- https://company.example/
```

Only after checking the allowlist, add `--telegram` to transmit the review preview. The button remains a physical mock block, and no mail transport or outbox is present.

## Interactive Telegram test bot

Configure the bot profile and run the allowlisted local polling adapter:

```powershell
npm run bot:configure
npm run bot:start
npm run bot:status
```

The bot answers `/start`, `/help`, `/status`, `/version`, accepts one company URL and returns a complete live preview. `Перегенерировать` is limited to two explicit attempts, `Отклонить` closes the review controls, and `Отправить` is always blocked. Stop the local adapter with `npm run bot:stop` before configuring a webhook or another polling process. See [the test-bot runbook](docs/runbooks/telegram-test-bot.md).

The local polling bot intentionally remains on the Stage-1 adapter and does not write to PostgreSQL. The verified Stage-2 approval/outbox path is present as an inactive n8n/database foundation; activating it requires the integration checklist in [the Stage-2 activation handoff](docs/handoff/stage-2-activation.md).

For a clean infrastructure start, migration and HTTPS health check:

```powershell
npm run smoke:docker
```

This command creates development-only secret files under ignored `.secrets/` only when missing and reuses them on later runs, starts only the pinned Workoutreach Compose project, applies migrations, queries migration evidence, then removes its test containers and volumes. It never silently rotates secrets behind an existing PostgreSQL volume.
It also proves approval replay/concurrency, suppression-at-approval, suppression-at-dispatch, mock claiming, and a business-database backup/restore into a clean temporary database.

For a committed clean-clone reproduction entirely below this repository root:

```powershell
npm run smoke:clean-clone
```

## Layout

- `n8n/code/lib/` — testable deterministic pipeline logic;
- `n8n/workflows/` — sanitized, inactive, credential-free workflow contracts;
- `schemas/` and `prompts/` — canonical model contracts;
- `evals/` — owner-approved URL-only calibration manifests with hard size limits;
- `templates/` and `product/` — versioned owner-approved campaign copy/profile, still non-sendable;
- `migrations/` — PostgreSQL business-state schema;
- `fixtures/` — synthetic source/model/offer evidence;
- `scripts/` — preflight, scans, SBOM, workflow validation and smoke commands;
- `docs/adr/` and `docs/runbooks/` — decisions and operating procedures.

## Implemented but intentionally inactive

- PostgreSQL migration `003_stage_2_mock_outbox` with one-time hashed approval tokens and 24-hour TTL;
- recipient suppression by keyed-HMAC fingerprint (the key is never stored in the database);
- atomic job lock, nonce consumption, state transition, operator action and unique mock-outbox insert;
- replay and concurrent-click handling with exactly one outbox row;
- second suppression check in the mock dispatcher;
- inactive, credential-free n8n contracts for approval and mock dispatch;
- repeatable database backup/restore smoke verification.

## Intentionally blocked

Do not add real keys merely to make CI green. Live OpenAI evaluation requires the ignored local secret configuration and an explicit command. Telegram requires a test token and explicit user/chat allowlist. Mailbox provider, legal review, corporate sender domain, retention deviations and production host are still owner inputs.

The complete interactive Stage-2 n8n adapter and Stages 3–5 are not activated. There is no mail adapter, provider event processing, production webhook, legal/provider approval, or live pilot path. The currently running local bot remains Stage 1 and therefore still reports `MOCK_SEND_BLOCKED`.

Tracked workflow exports intentionally contain no n8n instance IDs. `scripts/prepare-workflow-import.mjs` creates ignored deterministic import copies because the pinned n8n CLI requires a workflow ID at database import time.

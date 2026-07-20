# Workoutreach

Workoutreach is a strict-greenfield, human-reviewed career-outreach prototype for Bitrix24 integrators. Stages 0–2 provide a reproducible bootstrap, deterministic offline dry-run and a local PostgreSQL-backed Telegram review workflow. A guarded single-owner Gmail SMTP adapter is implemented but remains disabled until the owner locally supplies and verifies a Google app password.

The project also includes a local read-mostly operator dashboard. It is deliberately not a CRM or a send channel: it shows company-level delivery/engagement state and permits only guarded manual engagement updates.

`TECHNICAL_SPEC.md` is the contract. `AGENTS.md` defines the durable repository isolation and safety policy.

## Current safety state

- OpenAI: deterministic stub in CI/default dry-run; an explicit `live:preview` uses the Responses API with strict Structured Outputs, `store=false` and no tools.
- Telegram: stub by default; an explicit `--telegram` may send only the preview to an allowlisted test chat.
- Mail: guarded Gmail SMTP adapter and at-most-once queue implemented; disabled by default, with no password in `.env` or Git.
- Template and candidate profile: owner-approved and versioned; only company name and personalization phrase are dynamic. Template eligibility alone cannot enable the disabled-by-default transport.
- CV: external read-only PDF validated by filename, signature, size and SHA-256; never tracked or provided to the model.
- Test data: synthetic `.example` fixtures with documented provenance and no PII.
- Model budget: at most two analyses per UTC day by default; each analysis reserves exactly two Structured Output calls before network access.

## Prerequisites

- Node.js 24 or newer;
- npm 11 or newer;
- Docker Desktop with Compose for the optional infrastructure smoke test.

## Verify stages 0–2

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

## Local Stage 2 Telegram bot

The preferred local runtime needs neither a public server nor a domain. It starts PostgreSQL, n8n, the loopback-only HTTPS proxy and one allowlisted Telegram long-polling bot:

```powershell
npm run local:start
npm run local:status
```

The bot answers `/start`, `/help`, `/status`, `/version`, accepts one company URL and returns a complete live preview. Jobs, evidence, contacts, analyses, immutable draft versions and review actions survive process/container restarts. `Перегенерировать` is limited to two explicit attempts, `Отклонить` closes the review, and `Отправить (mock)` creates exactly one local outbox row while explicitly reporting that no email was sent.

Use `npm run local:stop` to stop containers without deleting their named volumes. Docker Desktop must be running; enable its own “Start Docker Desktop when you sign in” option if the bot should recover automatically after Windows login. Container restart policy is `unless-stopped`. See [the local Stage-2 runbook](docs/runbooks/local-stage2.md).

The owner-approved local capacity is `DAILY_ANALYSIS_LIMIT=40`, with two independent OpenAI calls reserved per analysis. The SMTP ceiling is 30 owner-approved messages per UTC day; every message still requires explicit Telegram approval plus database suppression and idempotency checks. Tests, verification and Docker smoke always use fixtures/stubs and make zero OpenAI calls.

## Stage the Bitrix24 Kazakhstan catalog

The vendor catalog can be refreshed without OpenAI or email delivery:

```powershell
npm run catalog:stage
```

The bounded reader respects `robots.txt`, accepts only canonical Kazakhstan partner profiles and records an ignored `artifacts/catalog/bitrix24-kz-latest.json` snapshot. Every row remains `REVIEW_REQUIRED`; staging never creates a job, model run, recipient, approval or outbox entry. The live catalog exposed 12 partner profiles on 2026-07-19, so the earlier 200+ estimate is not used as a Kazakhstan count.

## Activate the selected Gmail mailbox

See [the Gmail SMTP activation runbook](docs/runbooks/smtp-activation.md). After creating a Google app password, run `npm run gmail:setup`; its hidden prompt stores the credential only in ignored `.secrets/smtp_password` and leaves delivery disabled. `npm run gmail:status` reports state without exposing it. `npm run gmail:self-test` authenticates SMTP and sends the explicit owner-only delivery check; it cannot target a company address. Only a successful self-test enables the database mail switch with an owner-approved ceiling of 30 campaign emails per UTC day. Each Telegram click creates one immutable queue command; ambiguous failures are never retried automatically. `npm run gmail:disable` restores all local mail kill switches.

For a clean infrastructure start, migration and HTTPS health check:

```powershell
npm run smoke:docker
```

This command creates development-only secret files under ignored `.secrets/` only when missing and reuses them on later runs, starts only the pinned Workoutreach Compose project, applies migrations, verifies a second no-op pass plus the SHA-256 migration registry, then removes its test containers and volumes. Applied migration versions are skipped; a modified historical migration or a database newer than the checkout is rejected. It never silently rotates secrets behind an existing PostgreSQL volume.
It also proves approval replay/concurrency, suppression-at-approval, suppression-at-dispatch, mock claiming, and a business-database backup/restore into a clean temporary database.

## Local operator dashboard

Run the one-time interactive setup:

```powershell
npm run dashboard:setup
```

Then open `https://dashboard.workoutreach.localhost`. Setup stores only a scrypt password hash plus separate DB/session Docker Secrets, provisions the least-privilege role for both clean and existing PostgreSQL volumes, applies pending versioned migrations, and starts the internal-only container. Before migration 008 is first applied to an existing running database it writes an ignored owner-only custom-format backup without printing rows.

Use `npm run dashboard:start`, `npm run dashboard:status` and `npm run dashboard:stop` for normal operation. The default tab shows only «Отправлено · ждём ответа». A real send means exactly `smtp + SMTP_ACCEPTED` and is labelled «Отправлено — принято Gmail SMTP»; mock rows are labelled «Тест — email не отправлен». See [the dashboard runbook](docs/runbooks/local-operator-dashboard.md).

For a committed clean-clone reproduction entirely below this repository root:

```powershell
npm run smoke:clean-clone
```

## Layout

- `n8n/code/lib/` — testable deterministic pipeline logic;
- `n8n/workflows/` — sanitized, inactive, credential-free workflow contracts;
- `schemas/` and `prompts/` — canonical model contracts;
- `evals/` — owner-approved URL-only calibration manifests with hard size limits;
- `templates/` and `product/` — versioned owner-approved campaign copy/profile; template eligibility is distinct from the disabled-by-default runtime transport;
- `migrations/` — PostgreSQL business-state schema;
- `fixtures/` — synthetic source/model/offer evidence;
- `scripts/` — preflight, scans, SBOM, workflow validation and smoke commands;
- `docs/adr/` and `docs/runbooks/` — decisions and operating procedures.
- `dashboard/` — local authenticated read-mostly company UI and constrained API;

## Implemented Stage 2 safety boundary

- PostgreSQL migration `003_stage_2_mock_outbox` with one-time hashed approval tokens and 24-hour TTL;
- recipient suppression by keyed-HMAC fingerprint (the key is never stored in the database);
- atomic job lock, nonce consumption, state transition, operator action and unique mock-outbox insert;
- replay and concurrent-click handling with exactly one outbox row;
- second suppression check in the mock dispatcher;
- inactive, credential-free n8n contracts for approval and mock dispatch;
- repeatable database backup/restore smoke verification.
- PostgreSQL-backed allowlisted Telegram long polling with update deduplication and restart recovery;
- immutable page/contact/analysis/draft persistence and one-time mock-send/regenerate/reject callbacks;
- database-atomic daily model-analysis reservation before any OpenAI request.

## Intentionally blocked

Do not add real keys merely to make CI green. Live OpenAI evaluation requires the ignored local secret configuration and an explicit command. Telegram requires a test token and explicit user/chat allowlist. SMTP remains disabled until the owner explicitly runs the local Gmail setup with a dedicated app password. The first delivery must target an owner-controlled address; provider-policy confirmation and reply/bounce ingestion remain Stage 3 gates.

The public/webhook n8n operator adapter, provider event processing and Stages 4–5 are not activated. Local Stage 2 deliberately uses long polling; a server/domain becomes relevant only for later 24/7 hosting or a webhook deployment.

Tracked workflow exports intentionally contain no n8n instance IDs. `scripts/prepare-workflow-import.mjs` creates ignored deterministic import copies because the pinned n8n CLI requires a workflow ID at database import time.

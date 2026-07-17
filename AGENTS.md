# Workoutreach repository policy

`TECHNICAL_SPEC.md` is the project contract. If implementation and the specification disagree, stop and report the mismatch unless the owner explicitly changes the contract.

## Scope and provenance

- Work only inside this repository root.
- Do not read, list, search, index, compare, link to, or reuse material from `C:\Dev\coldmails` or any other local donor repository.
- Project code, workflows, prompts, schemas, migrations, templates, fixtures, tests, configuration, and documentation must be newly authored for Workoutreach.
- Allowed sources are the technical specification, direct owner materials, official vendor documentation, open standards, and pinned registry dependencies with license review.
- A missing decision requires an owner question or a new ADR. It never authorizes donor access.

## Safety boundaries

- `LIVE_SEND_ENABLED` must remain `false` through stages 0, 1, and the local Stage 2 mock-review runtime.
- CI and default dry-run use stub OpenAI, Telegram, and mail transports. An owner-invoked `live:preview` may use the Responses API and may transmit only a review preview to an explicitly allowlisted Telegram test chat. Mail remains disabled, and live credentials stay only in ignored `.env`, Docker Secrets, or n8n credentials.
- The owner-approved Stage 2 bot may run as one local allowlisted long-polling container backed by PostgreSQL. A public webhook is optional future infrastructure, not a prerequisite for the local workflow. Mail remains disabled and approval creates only a mock outbox row.
- Never print, persist in tracked files, pass to a model, or include in errors any token, API key, allowlist identifier, attachment path, or raw credential response.
- Unsafe or ambiguous URL, evidence, contact, model, or template input must stop with a typed result. Do not synthesize fallback facts.
- Every accepted result must include locally verifiable evidence from a loaded synthetic fixture or an explicitly authorized live page.

## Required verification

Run `npm run verify` before handing off changes. When Docker is available, also run `npm run smoke:docker`. The greenfield guard, secret scan, license scan, workflow validator, tests, preflight, and SBOM generation are mandatory gates.

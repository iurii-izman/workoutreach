# Workoutreach repository policy

`TECHNICAL_SPEC.md` is the project contract. If implementation and the specification disagree, stop and report the mismatch unless the owner explicitly changes the contract.

## Scope and provenance

- Work only inside this repository root.
- Do not read, list, search, index, compare, link to, or reuse material from `C:\Dev\coldmails` or any other local donor repository.
- Project code, workflows, prompts, schemas, migrations, templates, fixtures, tests, configuration, and documentation must be newly authored for Workoutreach.
- Allowed sources are the technical specification, direct owner materials, official vendor documentation, open standards, and pinned registry dependencies with license review.
- A missing decision requires an owner question or a new ADR. It never authorizes donor access.

## Safety boundaries

- `LIVE_SEND_ENABLED` must remain `false` through stages 0 and 1.
- CI and dry-run use stub OpenAI, Telegram, and mail transports. Never add real tokens, API keys, mailbox credentials, production identifiers, or PII fixtures.
- Unsafe or ambiguous URL, evidence, contact, model, or template input must stop with a typed result. Do not synthesize fallback facts.
- Every accepted result must include locally verifiable evidence from a loaded synthetic fixture or an explicitly authorized live page.

## Required verification

Run `npm run verify` before handing off changes. When Docker is available, also run `npm run smoke:docker`. The greenfield guard, secret scan, license scan, workflow validator, tests, preflight, and SBOM generation are mandatory gates.

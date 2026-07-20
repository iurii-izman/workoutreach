# Source provenance

## Project-owned material

All files other than `TECHNICAL_SPEC.md` were newly authored for Workoutreach on 2026-07-16 from the following permitted inputs:

- `TECHNICAL_SPEC.md` Final v1.1;
- direct instruction from the owner in this task;
- the owner-supplied research instruction, exact campaign email, current CV and explicitly supplied company URL;
- official OpenAI, n8n, PostgreSQL, Caddy, Telegram, Docker, Node.js, npm, JSON Schema, and relevant RFC documentation;
- public packages and container images listed in `docs/dependency-inventory.md`.

No local repository outside this root was read, listed, searched, indexed, compared, linked, or used as an implementation source.

The CV is an authorized owner input but remains an external read-only runtime asset. Neither the PDF, its local path nor its approval hash is tracked. Only CV-supported claims selected by the owner are represented in the versioned offer profile.

The public Bitrix24 Kazakhstan partner catalog is an authorized seed source. `npm run catalog:stage` reads only the catalog and its bounded partner profiles, respects `robots.txt`, makes no model calls, creates only an ignored `REVIEW_REQUIRED` snapshot and never authorizes transmission. On 2026-07-19 the rendered Kazakhstan catalog exposed 12 partner profiles; this dynamic observation must not be generalized to the previously estimated 200+ companies or to other countries.

The local operator dashboard, migration 008, synthetic dashboard smoke fixtures, ADR-0009 and its runbook were newly authored on 2026-07-20 from the owner's direct dashboard requirements, the project contract and existing project-owned schema. No donor repository or external application source was consulted.

Pilot contact resolution, migration 011, Telegram operator commands, ADR-0012 and the pilot runbook were newly authored on 2026-07-20 from the owner's direct requirements and the existing Workoutreach contracts. No donor repository or external application source was consulted.

## First-commit evidence

The repository root commit is `70b54615815fe254f61a19f5c44c4c7732222bb6` and contains only `TECHNICAL_SPEC.md`.

## Fixture policy

Every fixture is synthetic, uses reserved example namespaces, and is recorded in `fixtures/README.md` with purpose, authorship, usage right, and PII review. Fixture content cannot be promoted to production copy.

# Stage 1 owner-input and guarded-live evidence

Date: 2026-07-17

## Credential and asset checks

- OpenAI API authentication passed using a non-generating models-list request.
- Telegram Bot API authentication passed for the test bot.
- No Telegram webhook is configured.
- No private bot update was available, so user/chat allowlists remain intentionally unconfigured.
- The external CV passed filename, regular-file, PDF signature, size and approved SHA-256 validation. Its path and hash remain only in ignored `.env`.
- Mail transport is `disabled`, `LIVE_SEND_ENABLED=false`, and no outbox exists.

## First owner-authorized live preview

The owner-provided `https://profi-soft.kz/` target completed a guarded live evaluation:

- six same-site pages loaded within the crawl budget and `robots.txt` policy;
- a published recruiting address was selected under the career-outreach policy;
- ambiguous published phone candidates were marked `NEEDS_REVIEW` rather than guessed;
- literal company fact and evidence gates passed;
- one 26-word Russian personalization sentence passed the approved-claim and template-separation gates;
- the runtime CV attachment passed validation;
- the API resolved configured `gpt-5.6` to `gpt-5.6-sol` for this run;
- fact call usage: 12,256 input and 356 output tokens;
- phrase call usage: 1,040 input and 368 output tokens;
- Telegram transmission was not requested;
- email transmission was impossible and did not occur.

Full runtime payload and model envelopes are under ignored `artifacts/evidence/`; they are intentionally not committed.

## Repository and infrastructure gates

- `npm run verify` passed greenfield, ignored-secret-store, license, workflow, eval-dataset, preflight, 41/41 test, SBOM and deterministic dry-run gates.
- Docker smoke imported all five inactive credential-free workflows and applied migrations `001_stage_0_1` and `002_owner_campaign_stage_1`.
- The Docker smoke cleanup left zero Workoutreach containers or volumes running.

## Defects found and closed

- Node.js 24 DNS lookup requested the callback in `all` mode; the pinned-DNS fetcher now returns the already validated address list without weakening SSRF controls.
- OpenAI rejects schema metadata and `uniqueItems` in this Structured Outputs transport; transport-only normalization was added while canonical Ajv validation remains unchanged.
- Live-model envelopes are written only to ignored evidence files so a failed literal gate can be diagnosed without logging credentials or committing runtime content.

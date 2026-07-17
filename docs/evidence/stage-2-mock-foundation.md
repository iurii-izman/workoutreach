# Stage-2 mock foundation evidence

Implemented scope:

- migration `003_stage_2_mock_outbox`;
- one-time nonce issuance and atomic mock approval;
- keyed-HMAC suppression table and double-check boundary;
- unique operator action and unique `(job_id, draft_version)` outbox command;
- concurrent claim with `FOR UPDATE SKIP LOCKED`;
- mock-only safety controls and provider-ID prohibition;
- inactive n8n approval/mock-dispatch exports;
- repeatable business-database backup/restore smoke;
- stable local Docker secrets that are created only when missing and never silently rotated behind an existing volume;
- unit, contract and Docker integration tests.
- migrations `004_local_stage_2_runtime` and `005_local_model_budget`;
- PostgreSQL-backed allowlisted local bot with update deduplication and restart recovery;
- immutable evidence/analysis/draft versions and one-time review actions;
- atomic daily analysis budget, conservative default two analyses and exactly two reserved model calls per analysis;
- no public bot/database port and no Telegram webhook requirement.

Verified outcomes:

- sequential replay: one outbox row;
- simultaneous replay: one outbox row;
- suppression: zero outbox rows;
- mock dispatch: first claim accepted locally, second claim has no work;
- external mail transmission: false;
- restored schema includes migrations 001–005;
- local runtime tests use synthetic fixtures and make zero OpenAI, Telegram and mail calls.

The local Telegram bot uses PostgreSQL. The credential-free n8n workflow contracts remain inactive, and no mail provider exists. `Отправить (mock)` records only a local command and never transmits email.

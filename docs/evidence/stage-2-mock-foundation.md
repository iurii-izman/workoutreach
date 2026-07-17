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

Verified outcomes:

- sequential replay: one outbox row;
- simultaneous replay: one outbox row;
- suppression: zero outbox rows;
- mock dispatch: first claim accepted locally, second claim has no work;
- external mail transmission: false;
- restored schema includes migrations 001, 002 and 003.

This evidence does not claim the local Telegram bot uses PostgreSQL, that the n8n workflows are activated, or that any mail provider exists. Those boundaries remain explicitly blocked.

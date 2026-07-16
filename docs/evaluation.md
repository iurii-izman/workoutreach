# Career-outreach evaluation protocol

The first calibration set is capped at ten owner-reviewed company URLs. URLs are added one at a time to `evals/career-kz/calibration.v1.json` with provenance. The manifest contains no email or phone data; contacts must be rediscovered from each authorized public site.

Each target is run separately with `npm run live:preview -- <URL>`. Telegram transmission is omitted during calibration. A human records:

| Criterion | Score |
| --- | --- |
| Literal fact and source are correct | pass/fail |
| Company name and published contact policy are correct | pass/fail/review |
| Company fact is specific and useful | 0–2 |
| Candidate overlap is defensible from one approved claim | 0–2 |
| Russian phrase is natural and specific | 0–2 |
| Phrase fits the fixed email without repetition | 0–2 |
| Unsupported praise, result, metric, role or production claim | disqualifying |
| Greeting, CTA, CV reference, signature or contact data in phrase | disqualifying |

Calibration acceptance requires all deterministic gates to pass, no disqualifying output, and owner acceptance of at least 8 of 10 complete previews. `NEEDS_CONTACT` and `NEEDS_REVIEW` are safe outcomes rather than model failures, but must be reviewed separately when measuring end-to-end readiness.

Only after prompt/model settings are frozen is a separate 40-target holdout created. Holdout results must not be used to tune the prompt. Processing all 200+ catalog partners is a later import decision and never implies email transmission.

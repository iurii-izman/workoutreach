# Data retention baseline

- Raw HTML is held in memory only for the current fetch and is never inserted into the business database.
- Normalized evidence excerpts, content hashes, contacts, analyses, and drafts default to 90 days.
- Successful n8n execution payloads are disabled. Error execution data is pruned after 168 hours.
- Synthetic fixtures contain no PII and are retained with the repository.
- Stage 2 stores suppression lookups only as keyed HMAC fingerprints; the HMAC key remains outside PostgreSQL. The final retention period still requires owner/legal approval before pilot.
- A disposable custom-format backup/restore smoke is automated for the business database. Production encryption, storage target, retention and quarterly restore evidence still require owner decisions.

Any deviation requires an owner decision and a documented retention migration.

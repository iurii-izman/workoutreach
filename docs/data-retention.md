# Data retention baseline

- Raw HTML is held in memory only for the current fetch and is never inserted into the business database.
- Normalized evidence excerpts, content hashes, contacts, analyses, and drafts default to 90 days.
- Successful n8n execution payloads are disabled. Error execution data is pruned after 168 hours.
- Synthetic fixtures contain no PII and are retained with the repository.
- Suppression HMAC retention, production backups, and quarterly restore evidence belong to later stages and must be completed before pilot.

Any deviation requires an owner decision and a documented retention migration.

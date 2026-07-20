# Data retention baseline

- Raw HTML is held in memory only for the current fetch and is never inserted into the business database.
- Normalized evidence excerpts, content hashes, contacts, analyses, and drafts default to 90 days.
- Successful n8n execution payloads are disabled. Error execution data is pruned after 168 hours.
- Synthetic fixtures contain no PII and are retained with the repository.
- Stage 2 stores suppression lookups only as keyed HMAC fingerprints; the HMAC key remains outside PostgreSQL. The final retention period still requires owner/legal approval before pilot.
- Dashboard company identity (`canonical_hostname`, canonical URL and first/last-seen timestamps), current engagement status and minimal append-only status history may outlive the 90-day content window so the owner can avoid duplicate or prohibited outreach. Safe notes are capped at 500 characters and must not contain email addresses, URLs or secrets. A future owner-approved retention process may delete old history but updates remain prohibited.
- The existing 90-day default is unchanged for drafts, evidence excerpts, analyses, contacts and other PII-bearing business records. Dashboard views must become empty/minimized when those source records are removed; they do not copy sent bodies or full recipient addresses into company state.
- Suppression fingerprints remain separate and are retained longer than content/history according to the owner/legal policy so `DO_NOT_CONTACT`, recipient request, unsubscribe, complaint and permanent bounce protections survive minimization.
- A disposable custom-format backup/restore smoke is automated for the business database. Production encryption, storage target, retention and quarterly restore evidence still require owner decisions.

Any deviation requires an owner decision and a documented retention migration.

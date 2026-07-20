# Provider and production compliance gate

A single-owner Gmail SMTP adapter is selected for the local Stage 3 path. It uses a dedicated app password in a Docker Secret, TLS submission, a one-message daily campaign limit, database suppression checks and explicit Telegram approval. Stage 2 retains its database-enforced mock transport for CI and offline verification.

The active owner-approved use case is individualized career outreach by one candidate to published business contacts of Bitrix24 integrators in Kazakhstan. Recruiting addresses are preferred, followed by general mailboxes and then a single explicitly published named business contact. Every selected address and complete message remains subject to human review, and a fixed reply-based opt-out is present. These product choices are not a legal determination and do not authorize bulk sending, automatic sending, purchased contact data, mailbox guessing, or expansion to another country.

Before a broader pilot, the owner must record target countries and recipient categories, outreach purpose and lawful basis, provider approval for the use case, visible opt-out handling, reply processing and any future sender-domain SPF/DKIM/DMARC status. Provider acceptance must never be described as inbox delivery.

CI preflight still forces `LIVE_SEND_ENABLED=false` and a disabled mail transport. Local activation is owner-only and documented in the SMTP runbook. Provider-policy confirmation, reply/bounce ingestion and any needed legal review remain incomplete gates before scale-up.

# Provider and production compliance gate

No mail provider is selected and no live send is implemented in stages 0–1.

Before stage 3, the owner must record target countries and recipient categories, outreach purpose and lawful basis, provider approval for the use case, corporate domain, visible opt-out text, reply handling, and SPF/DKIM/DMARC status. Provider acceptance must never be described as inbox delivery.

`LIVE_SEND_ENABLED=true`, a non-disabled mail transport, or production credentials cause current preflight to fail. This document is intentionally incomplete until the owner supplies the missing decisions.

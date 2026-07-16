# Unsubscribe and suppression

No mail is sent in stages 0–1, so no unsubscribe endpoint is active.

Before any pilot, an HTTPS unauthenticated idempotent endpoint must immediately write a recipient HMAC to suppression. Visible text opt-out remains mandatory. Complaint, unsubscribe and permanent hard-bounce events must suppress before any later send check. Raw email addresses must not be exposed in URLs, logs or Telegram.

This runbook cannot be marked operational until stage 2 suppression and stage 3 provider events are implemented and tested.

# Unsubscribe and suppression

Stages 0–1 do not send mail. The current Stage 3 pilot uses a visible reply-based opt-out and an operator-managed suppression list; no public unsubscribe endpoint is active.

Before automated or broader-scale operation, an HTTPS unauthenticated idempotent endpoint must immediately write a recipient HMAC to suppression. Visible text opt-out remains mandatory. Complaint, unsubscribe and permanent hard-bounce events must suppress before any later send check. Raw email addresses must not be exposed in URLs, logs or Telegram.

Stage 2 suppression and the send-time double check are implemented and tested. Automatic provider event/reply ingestion is not implemented, so the owner must review Gmail manually and immediately record opt-out, complaint and permanent-bounce signals before any further approval. This runbook cannot be marked fully automated until event ingestion is implemented and tested.

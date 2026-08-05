# Pilot operations

## Purpose

This runbook covers the first owner-operated evaluation and gradual delivery period. It does not authorize automated or bulk sending. Every URL, recipient, evidence item, draft and send remains individually reviewed.

## Before each session

1. Run `npm run local:status`; PostgreSQL, bot, n8n, proxy and dashboard must be healthy and migrations 011–012 must be present.
2. In Telegram run `/usage` and `/queue`.
3. Check the Gmail inbox, sent folder and delivery-failure messages. Record replies, opt-outs, complaints and permanent failures in the dashboard/suppression workflow before approving anything else.
4. If runtime status is ambiguous, do not approve. Use `npm run gmail:disable` and investigate.

## Review one company

1. Send one public company URL to the bot.
2. If Telegram presents contacts, verify category and source. Do not use a protected mailbox. If no email is published, use `/email WO-XXXXXX address` only when the address is independently and reliably known.
3. Verify recipient, published/manual source, fixed subject and body, and CV attachment.
4. Reject the job when the recipient or source is unsuitable; the fixed letter has no regeneration action.
5. Approve the immutable draft once. Gmail SMTP acceptance means only that Gmail accepted the message; it does not prove inbox delivery or reading.

## Fifty-company evaluation and send ramp

- Complete up to 50 contact/draft reviews as the quality dataset; record unsuitable contacts, source failures, bounces and replies.
- Do not interpret the 30/day technical ceiling as a target.
- Start real delivery at no more than 5 reviewed messages in a day. Increase to 10, then 20 only after manual inspection of replies and failure signals. Stay below 30/day.
- Stop the ramp on any complaint, repeated permanent bounce, unexpected duplicate, wrong-company evidence, recipient-policy mistake or Gmail restriction.
- Expansion to other countries requires recipient-purpose, local-law and provider review; the fixed Russian text should be used only where Russian is appropriate for the recipient.

## End of session

1. Run `/usage` and compare accepted SMTP count with Gmail Sent.
2. Run `/queue`; resolve or intentionally leave each actionable job.
3. Update engagement statuses in `https://dashboard.workoutreach.localhost`.
4. Preserve no raw credentials or message payloads in notes. Use job IDs for correlation.

## Emergency stop

Run `npm run gmail:disable`. If unavailable, run `docker compose stop workoutreach-bot`, then revoke the Gmail app password. Follow [incident-kill-switch.md](incident-kill-switch.md).

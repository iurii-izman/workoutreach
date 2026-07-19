# ADR 0008: single-owner Gmail SMTP credential

## Status

Accepted for the local Stage 3 adapter; live sending remains owner-activated and human-approved.

## Context

The owner selected one personal Gmail mailbox for the first local pilot. The existing adapter supports authenticated SMTP submission with TLS and an at-most-once queue. OAuth 2.0 would add a Google Cloud client, consent flow, refresh-token lifecycle and recovery work before it improves the one-mailbox local workflow.

## Decision

- Use `smtp.gmail.com:465` with TLS 1.2+ and one dedicated Google app password.
- Keep the Gmail address only in ignored `.env` and the app password only in ignored `.secrets/smtp_password`, mounted read-only as a Docker Secret.
- Reject the normal account password operationally by accepting only Google's normalized 16-character app-password form.
- Make activation an explicit owner command, authenticate with SMTP `verify()` without transmitting mail, and start with a hard daily limit of one.
- Preserve human approval, suppression checks, immutable drafts, CV hash verification, at-most-once claiming and the kill switch.
- Keep OAuth 2.0 as the migration path for multiple mailboxes, 24/7 hosting or a provider-policy requirement.

## Consequences

The current route is small, reversible and usable locally. The owner must enable Google 2-Step Verification and create the app password manually. A changed Google account password revokes the app password. Reply/bounce ingestion is not provided by SMTP submission and remains a later provider-events task.

## Sources

- [Google: app passwords](https://support.google.com/accounts/answer/185833?hl=en-GB)
- [Google: SMTP configuration](https://support.google.com/a/answer/176600)
- [Google: OAuth for Gmail SMTP](https://developers.google.com/workspace/gmail/imap/imap-smtp)

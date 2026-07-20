# Guarded Gmail SMTP activation

SMTP delivery is implemented and disabled by repository default. An owner runtime can activate it only through this runbook. The selected sender is configured only in ignored `.env`. Use a dedicated Google app password; never enter the normal Gmail password into this project or send either password through chat.

Google app passwords require 2-Step Verification and may be unavailable for accounts using Advanced Protection, security-key-only 2-Step Verification, or some managed-organization policies. Google revokes app passwords after the main account password changes. See [Google Account Help](https://support.google.com/accounts/answer/185833?hl=en-GB).

## One-time manual prerequisite

1. Enable 2-Step Verification on the sender Google account if it is not already enabled.
2. Create a new app password named `Workoutreach` in the Google Account security settings.
3. Do not paste it into `.env`. From `C:\Dev\workoutreach`, run:

```powershell
npm run gmail:setup
```

The prompt is hidden. Spaces in Google's displayed four-character groups are accepted. The script writes the normalized 16-character value only to ignored `.secrets/smtp_password`, removes any legacy `SMTP_PASSWORD` line from `.env`, pins `smtp.gmail.com:465` and restarts the local runtime with all mail kill switches still enabled.

The sender address must already be present in ignored `.env`:

```dotenv
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_USER=YOUR_GMAIL_ADDRESS
MAIL_FROM_ADDRESS=YOUR_GMAIL_ADDRESS
MAIL_FROM_NAME=Юрий Изман
```

Gmail documents `smtp.gmail.com` with SSL port 465 or TLS port 587. Workoutreach pins implicit TLS on port 465; invalid certificates and TLS below 1.2 are rejected. See [Google Workspace Admin Help](https://support.google.com/a/answer/176600).

## Verify credential staging

```powershell
npm run gmail:status
npm run local:status
```

`gmail:status` is local-only and never prints the credential. At this point it reports `GMAIL_SELF_TEST_REQUIRED`, while PostgreSQL remains `mail.enabled=false`, `transport=disabled`, `daily_limit=0`, `kill_switch=true`.

Then explicitly send one diagnostic message only to the configured sender address:

```powershell
npm run gmail:self-test
```

The command refuses any recipient other than the configured Gmail sender, authenticates SMTP, makes no OpenAI call, revalidates the CV and writes redacted acceptance evidence to ignored `artifacts/evidence/gmail-self-test.json`. Only after provider acceptance does it set the owner-approved daily campaign ceiling to 30 and restart the runtime. PostgreSQL then reports `mail.enabled=true`, `transport=smtp`, `daily_limit=30`, `kill_switch=false`; new Telegram previews show `Отправить email`. This remains a hard safety ceiling: every message still requires individual Telegram approval.

Inspect the received sender, subject, plain-text/HTML rendering and PDF attachment before using the Telegram send action. Running `npm run gmail:self-test` again while live delivery is enabled is refused; disable Gmail first if a deliberate repeat is needed.

For a `DRAFT_READY` job created after migration `007_stage_3_template_sendability`, run `/status WO-XXXXXX` and then `/approve WO-XXXXXX` in the private bot. The bot shows recipient, subject and immutable draft version before creating a fresh one-time send button. Legacy drafts remain `sendable=false` by design; submit their company URL again rather than upgrading old content in place.

Do not approve the first campaign delivery until that owner-only message has been inspected. SMTP acceptance means Gmail accepted the message; it does not prove inbox delivery. The worker never automatically retries an ambiguous attempt.

## Emergency stop

Run `npm run gmail:disable`. It restores `MAIL_TRANSPORT=disabled`, `LIVE_SEND_ENABLED=false`, `DAILY_SEND_LIMIT=0`, restarts the runtime and returns the database kill switch to enabled. It preserves the app password file so an accidental stop does not require rotating credentials; deleting/revoking that app password in Google is the independent hard stop.

OAuth 2.0/XOAUTH2 remains the preferred future option if the project moves to multiple mailboxes or long-lived hosting; Google documents OAuth for SMTP, but it requires a separate Google Cloud OAuth client and interactive consent lifecycle. See [Gmail IMAP/POP/SMTP](https://developers.google.com/workspace/gmail/imap/imap-smtp) and [XOAUTH2 protocol](https://developers.google.com/workspace/gmail/imap/xoauth2-protocol).

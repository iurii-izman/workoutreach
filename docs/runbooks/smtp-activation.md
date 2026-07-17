# Guarded SMTP activation

SMTP delivery is implemented but disabled. Use one mailbox controlled by the owner and a dedicated app password; never place the normal mailbox password in the project.

## Required local values

Add these values to ignored `.env` without sending the password through chat:

```dotenv
MAIL_TRANSPORT=smtp
LIVE_SEND_ENABLED=true
SMTP_HOST=SMTP_HOST_FROM_PROVIDER
SMTP_PORT=465
SMTP_USER=YOUR_MAILBOX_ADDRESS
SMTP_PASSWORD=YOUR_DEDICATED_APP_PASSWORD
MAIL_FROM_ADDRESS=YOUR_MAILBOX_ADDRESS
MAIL_FROM_NAME=Юрий Изман
DAILY_SEND_LIMIT=1
```

Use port 465 for implicit TLS. Port 587 is also accepted and forces STARTTLS. Other ports, invalid certificates and TLS below 1.2 are rejected.

## Activate

```powershell
npm run local:start
npm run local:status
```

Startup first verifies DNS, TLS and SMTP authentication without sending a message. Only after successful verification does PostgreSQL report `mail.enabled=true`, `transport=smtp`, `daily_limit=1`, `kill_switch=false`. A newly generated Telegram preview then shows `Отправить email`.

To reuse an already reviewed `DRAFT_READY` job without another OpenAI call, run `/status WO-XXXXXX` and then `/approve WO-XXXXXX` in the private bot. The bot shows recipient, subject and immutable draft version before creating a fresh one-time send button.

Test the first real delivery only to an address owned by you. SMTP acceptance means the provider accepted the message; it does not prove inbox delivery. The worker never automatically retries an ambiguous attempt.

## Emergency stop

Set `MAIL_TRANSPORT=disabled`, `LIVE_SEND_ENABLED=false`, and `DAILY_SEND_LIMIT=0` in ignored `.env`, then run `npm run local:start`. The database kill switch returns to enabled. Revoking the provider app password is the independent hard stop.

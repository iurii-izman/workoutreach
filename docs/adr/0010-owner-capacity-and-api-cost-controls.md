# ADR 0010: Owner capacity and API cost controls

Status: accepted — 2026-07-20

## Context

The owner intends to review and approve 20–30 personalized messages per day. The initial one-message SMTP limit and two-analysis OpenAI limit block that workflow. A successful two-stage run used 8,339 tokens; earlier attempts that stop after fact extraction still incur the completed first-call cost.

ChatGPT Plus and API usage are separately billed products. The local service therefore continues to reuse the existing project API key; it does not create another key, automate `chatgpt.com`, or import browser session credentials.

## Decision

- Keep a finite database-enforced SMTP ceiling and raise its configurable maximum/default to 30 messages per UTC day.
- Set the local analysis capacity to 40 per UTC day, leaving room for safe stops and explicit regenerations while keeping a predictable cost boundary.
- Preserve explicit human approval, suppression checks, immutable drafts, idempotent outbox commands and the kill switch for every message.
- Keep the quality reference on `gpt-5.6` until a representative eval approves cheaper role-specific models. Support independent fact and phrase model configuration without activating a downgrade implicitly.
- Disable the implicit GPT-5.6 prompt-cache breakpoint for the normally unique company payloads by using explicit cache mode with no breakpoint.
- Persist response service tier plus cached and reasoning token details when the API returns them.
- Keep Standard processing as the interactive default. Flex may be evaluated later with longer timeouts, retry/backoff and Standard fallback because it trades lower price for slower or temporarily unavailable processing.

## Consequences

Thirty is an application safety ceiling, not a provider guarantee or an instruction to send unsolicited mail automatically. Gmail acceptance is not inbox delivery. The owner must monitor invalid recipients, replies, opt-outs, provider errors and spam complaints; volume should be reduced immediately if negative signals appear.

## References

- <https://developers.openai.com/api/docs/pricing>
- <https://developers.openai.com/api/docs/guides/prompt-caching>
- <https://developers.openai.com/api/docs/guides/flex-processing>
- <https://help.openai.com/en/articles/9039756-billing-settings-in-chatgpt-vs-platform>
- <https://support.google.com/mail/answer/22839>
- <https://support.google.com/mail/answer/81126>

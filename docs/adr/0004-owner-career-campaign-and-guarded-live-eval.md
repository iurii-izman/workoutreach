# ADR-0004: Owner career campaign and guarded live evaluation

- Status: Accepted
- Date: 2026-07-17

## Context

The owner supplied the exact research instruction, final Russian email copy, current CV, OpenAI API credential, Telegram test-bot credential, and the initial target category: Bitrix24 integrators in Kazakhstan. The owner also explicitly confirmed that the project must remain greenfield and that email delivery must not be enabled yet.

Stage 1 now needs representative live evaluation without weakening the offline CI boundary or creating an accidental send path.

## Decision

1. The campaign type is `career_outreach`. Published recruiting mailboxes are preferred, then a single general mailbox. Sales, support, legal/privacy, personal and unknown addresses are never auto-selected for this campaign. Addresses are extracted only from the site; none are guessed.
2. The owner-approved candidate profile is versioned in `product/offer-profile.v1.yaml`. Only its claim IDs may be used by the phrase model. Unsupported roles, production/commercial AI claims, metrics, guarantees and client names are forbidden.
3. The exact owner email is versioned as `email-ru-career-v1`. Only `COMPANY_NAME` and `PERSONALIZATION_PHRASE` are dynamic. The signature, links and all other copy are static. By direct owner amendment on 2026-07-20, the dedicated opt-out sentence is omitted during the manually reviewed 50-letter pilot; negative replies still require immediate suppression. The manifest remains `sendable=false`.
4. The CV remains an external read-only runtime asset. Its path and approved SHA-256 exist only in ignored secret configuration. Runtime validation checks a regular non-symlink PDF, filename, size, signature and content hash before a live preview. The file and its path are never committed or sent to either model.
5. CI and `dry-run` remain credential-free stubs. `live:preview` is an explicit, single-URL, owner-invoked mode. It may call OpenAI and may send a preview only to an allowlisted Telegram test chat when `--telegram` is separately present. It cannot send email or create an outbox entry.
6. Both OpenAI calls use the Responses API, `store=false`, no tools, strict Structured Outputs and explicit low reasoning effort. Refusal, incomplete output, invalid JSON, schema mismatch, evidence mismatch and business-gate mismatch are controlled stops.
7. The canonical JSON Schemas remain the local Ajv authority. API transport copies omit only unsupported schema metadata/keywords (`$schema`, `$id`, `uniqueItems`); canonical validation still enforces them after the response.
8. Personalization uses one verified company fact and exactly one approved candidate claim. The target is 25–35 Russian words; the hard accepted range is 18–40 words and exactly one sentence.
9. The Bitrix24 Kazakhstan partner catalog is an authorized source of future seed URLs, not authority for bulk execution. Expansion beyond a reviewed calibration set requires a separate dataset decision and does not authorize auto-send.

## Consequences

- A meaningful live preview can be evaluated now while mail remains physically unavailable.
- Telegram transmission remains blocked until an owner user/chat allowlist is populated.
- Attachment validation prevents silently sending a changed CV in a later stage.
- A model-produced phrase is never sufficient by itself: local schema, literal evidence, claim, length, sentence and template gates remain mandatory.
- The next acceptance step is owner review of a small calibration set, not processing all catalog partners.

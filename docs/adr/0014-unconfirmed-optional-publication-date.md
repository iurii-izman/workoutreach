# ADR 0014: Safe downgrade of an unconfirmed optional publication date

Status: accepted — 2026-07-22

## Context

The fact model can return a schema-valid ISO publication date after translating or reformatting a localized date from a page. The mandatory fact, excerpt, source and company can all remain literally supported while that optional date is absent from the selected evidence excerpt. Rejecting the complete analysis in this case creates a false stop without improving the grounding of the personalization.

## Decision

- Keep source, source type, literal excerpt, literal fact, company identity and model decision as hard evidence gates.
- Preserve a non-null `published_at` only when its exact ISO value is present in the selected evidence excerpt.
- Deterministically replace an unconfirmed optional date with `null` and add `PUBLISHED_AT_UNCONFIRMED_REMOVED` to the operator-visible warnings.
- Instruct the fact model not to translate or reformat localized dates and version that prompt change as `fact-extraction.v2`.
- Do not infer, normalize or recover a date from other page content.

## Consequences

A valid grounded fact can proceed to human review when only optional date metadata is unsupported. The resulting draft never contains an unverified date, and the operator can see that the value was removed. All mandatory evidence failures continue to stop the pipeline.

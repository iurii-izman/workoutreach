# ADR-0003: Literal fact grounding in stage 1

- Status: accepted
- Date: 2026-07-16

## Context

The contract requires code to reject material claims absent from an evidence excerpt. A general semantic entailment checker would add another probabilistic decision and cannot be trusted as a deterministic gate.

## Decision

Stage 1 accepts a fact only when its whitespace-normalized text is a literal substring of the verified source excerpt. The excerpt itself must be a literal substring of the normalized text of the named loaded page. Dates and company names receive independent literal checks.

This is deliberately stricter than the product may ultimately need. A later relaxation requires an ADR, representative eval evidence, and a deterministic or human-review control.

## Consequence

Safe paraphrases may stop at `REJECTED_INSUFFICIENT_EVIDENCE`; unsupported claims cannot pass by lexical similarity alone.

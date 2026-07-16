# ADR-0001: Strict greenfield implementation

- Status: accepted
- Date: 2026-07-16
- Contract: `TECHNICAL_SPEC.md` sections 0, 2, and 19

## Context

Workoutreach must be independently reproducible without any local legacy repository, hidden package, runtime export, credential, or prior-chat artifact.

## Decision

All project-owned material is authored in this repository. Donor repositories are outside the information boundary. Dependencies come only from pinned public registries after provenance and license review. Missing design decisions are resolved through owner input or a new ADR.

The root Git commit contains only the approved technical specification. Policy, provenance, dependency inventory, guardrails, and application files are introduced after that provenance anchor.

## Controls

`scripts/greenfield-guard.mjs` rejects submodules, external links, path dependencies, external bind mounts, donor path references outside policy allowlists, and non-project namespaces. CI runs it before tests.

## Consequences

No legacy compatibility is implied. Clean-clone reproducibility and explicit evidence take priority over implementation speed.

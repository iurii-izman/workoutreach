# Synthetic fixture provenance

| Fixture | Purpose | Origin and right to use | PII review |
| --- | --- | --- | --- |
| `sites/synthetic-company` | normal crawl/contact/evidence path | Newly authored for Workoutreach; uses the RFC-reserved `.example` namespace | no real person, organization, domain, phone, or mailbox |
| `model-results/synthetic-company` | deterministic two-call Structured Outputs path | Newly authored for Workoutreach from the synthetic site text | no PII; fact is a literal fixture excerpt |
| `offer-profile.synthetic-eval.v1.yaml` | prove offer-claim gate without inventing production claims | Newly authored and explicitly limited to tests | synthetic only; `sendable=false` |

Fixtures may be used only for tests and dry-run evidence. They are not owner-approved marketing content.

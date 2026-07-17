# Dependency inventory

Versions are exact. Registry locks and container manifest digests are the reproducibility evidence.

| Component | Version / digest | Source | License | Purpose | Review |
| --- | --- | --- | --- | --- | --- |
| Node.js | >=24 runtime contract | nodejs.org | MIT | test and dry-run runtime | allowed |
| ajv | 8.20.0 | npmjs.com/package/ajv | MIT | canonical JSON Schema validation | allowed |
| cheerio | 1.2.0 | npmjs.com/package/cheerio | MIT | deterministic HTML parsing | allowed |
| ipaddr.js | 2.4.0 | npmjs.com/package/ipaddr.js | MIT | IP range classification | allowed |
| pg | 8.22.0 | npmjs.com/package/pg | MIT | parameterized PostgreSQL client for the local bot container | allowed |
| nodemailer | 9.0.3 | npmjs.com/package/nodemailer | MIT-0 | guarded authenticated SMTP submission with TLS | allowed |
| Node.js container | 24.18.0-alpine / `sha256:4ba75f835bb8802193e4c114572113d4b26f95f6f094f4b5229d2a77773e0afc` (linux/amd64 manifest) | Docker Official Image | MIT + bundled notices | isolated local bot runtime | allowed |
| n8n | 2.30.5 / `sha256:450853cd21a2ce36587c4c860eb26927c1ceba9496bf55f4c213b5d3a6dc8c6f` | vendor `n8nio/n8n` Docker Hub mirror (same manifest as docker.n8n.io) | Sustainable Use License + enterprise portions | orchestration | allowed for internal use; owner must re-review deployment use |
| PostgreSQL | 17.10-alpine / `sha256:742f40ea20b9ff2ff31db5458d127452988a2164df9e17441e191f3b72252193` | Docker Official Image | PostgreSQL License | business state and n8n metadata | allowed |
| Caddy | 2.11.4-alpine / `sha256:5f5c8640aae01df9654968d946d8f1a56c497f1dd5c5cda4cf95ab7c14d58648` | Docker Official Image | Apache-2.0 | HTTPS reverse proxy | allowed |

The n8n pin deliberately selects the stable 2.30 line. The 2.31 line was marked pre-release in the official release feed at review time.

Run `npm run licenses` and `npm run sbom` after any dependency change. Dependency updates require their own reviewable change.

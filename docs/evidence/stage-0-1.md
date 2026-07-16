# Stage 0–1 evidence record

- Date: 2026-07-16
- Scope: bootstrap and offline dry-run only
- Live send: disabled

## Provenance

Root commit `70b54615815fe254f61a19f5c44c4c7732222bb6` contains only `TECHNICAL_SPEC.md`. The greenfield guard resolves every inspected path within the repository, rejects donor paths/namespaces outside policy allowlists, and verifies no submodule, external symlink/junction, path dependency, or external bind mount.

## Automated verification

`npm run verify` passed:

- greenfield guard;
- secret scan;
- license scan for 29 npm packages plus reviewed container inventory;
- five sanitized workflow contracts;
- production-locked CI preflight;
- 28 unit, contract, integration, security, and E2E tests;
- deterministic CycloneDX SBOM with 32 components;
- complete synthetic Telegram preview dry-run.

The dry-run produced job `WO-7EED3J`, three loaded HTML pages, one published general contact, a literal source excerpt, a 20-word Russian phrase, a non-sendable draft and `transmitted=false` / `outbox_created=false`. Machine-readable request/source/template hashes are written to ignored `artifacts/evidence/dry-run.json` on each run.

## Docker smoke

`npm run smoke:docker` passed against exact image digests:

- PostgreSQL, n8n and Caddy healthchecks became healthy;
- all five tracked ID-free workflow exports were transformed to ignored deterministic import copies and imported successfully into pinned n8n;
- migration `001_stage_0_1` committed and was read back from PostgreSQL;
- Compose removed all test containers, networks and volumes afterward.

The initial `docker.n8n.io` layer download stalled. The final Compose reference uses the vendor-published `n8nio/n8n` Docker Hub mirror. Manifest inspection confirmed the identical pinned digest `sha256:450853cd21a2ce36587c4c860eb26927c1ceba9496bf55f4c213b5d3a6dc8c6f` before the change.

## External contract evidence

- OpenAI Structured Outputs uses Responses API `text.format` with strict JSON Schema; refusal remains a distinct controlled response. The configured model baseline is `gpt-5.6`, `store=false`, and no tools: <https://developers.openai.com/api/docs/guides/structured-outputs>.
- n8n SSRF protection covers redirect targets and DNS resolution/rebinding and remains defense-in-depth beside network policy: <https://docs.n8n.io/hosting/securing/ssrf-protection/>.
- Risky nodes are blocked through `NODES_EXCLUDE`: <https://docs.n8n.io/hosting/securing/blocking-nodes/>.

## Acceptance still requiring owner input

This record proves deterministic synthetic behavior, not live-model quality or live Telegram delivery. Owner-approved prompt material, offer profile, email template, test credentials and representative eval acceptance remain open. Stages 2–5 and all real sending are outside this record.

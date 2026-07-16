# Deploy stages 0–1

1. Confirm the working tree and commit under review.
2. Run `npm ci --ignore-scripts` and `npm run verify`.
3. Run `npm run smoke:docker`; retain its terminal output with the change evidence.
4. Review `docs/dependency-inventory.md`, `THIRD_PARTY_NOTICES.md`, and the generated SBOM.
5. Keep all n8n workflows inactive. Import only the sanitized files under `n8n/workflows/`.
6. Do not configure OpenAI, Telegram, or mail credentials until their owner gates are satisfied.

The local Caddy certificate is for development. Production DNS, public certificate, editor access restriction, firewall egress policy, backup target, and external secret store require a later deployment decision.

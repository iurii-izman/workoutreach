# ADR 0013: Public-only DNS pinning

Status: accepted — 2026-07-22

## Context

Some public company sites publish a valid public address in one DNS family and a broken private or link-local address in the other. Rejecting the whole hostname creates a false stop even though the HTTP transport already uses a custom pinned lookup and does not need to expose every DNS answer to the socket.

## Decision

- Resolve all A/AAAA answers before every request and redirect.
- Validate every answer and pass only globally routable addresses to the pinned HTTP lookup.
- Never pass loopback, private, link-local, multicast, documentation or other reserved answers to the transport.
- Stop with `URL_ADDRESS_BLOCKED` when no public answer remains; malformed DNS data still stops immediately.
- Keep literal-IP, hostname, port, redirect, TLS, same-site, response-size and timeout gates unchanged. Do not add an external-hostname allowlist or an SSRF bypass.

## Consequences

A dual-stack site with a public A record and a broken link-local AAAA record can be loaded over the validated public address. A hostname that resolves only to blocked ranges still fails closed. DNS rebinding remains bounded because the network request receives only the already validated, pinned address set and each redirect is resolved and validated again.

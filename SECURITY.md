# Security policy

## Reporting a vulnerability

Please do not open a public issue for a suspected vulnerability or accidental credential exposure.
Use GitHub's private vulnerability reporting for this repository instead.

Include the affected version, reproduction steps, impact, and any suggested mitigation. Do not include
live Wildberries cookies, account data, private keys, or tokens in the report.

## Security model

`wb-shopping-mcp` is a local stdio server for interactive, read-only product research. It is not
designed to run as a public network service or as a high-volume crawler.

- Browser state is stored outside the repository with private filesystem permissions.
- Product inputs cannot select an arbitrary network host.
- Requests are serialized and rate-limited.
- Unknown internal errors are redacted before they reach MCP clients.
- Marketplace content is untrusted data and must never be treated as agent instructions.

See [docs/architecture.md](docs/architecture.md) for the complete trust boundaries.

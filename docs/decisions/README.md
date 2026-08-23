# Architecture Decision Records

This directory records material architecture choices that affect implementation, security, interoperability, or project governance. Each record is intentionally narrow, describes rejected alternatives, and names an observable condition that should trigger review.

## Index

- [ADR-0001: Use TypeScript and Node.js for the first implementation](0001-typescript-node-first-implementation.md)
- [ADR-0002: License the repository under Apache-2.0](0002-apache-2-license.md)
- [ADR-0003: Use better-sqlite3 until node:sqlite is stable](0003-better-sqlite3-until-node-sqlite-stable.md)
- [ADR-0004: Use the Codex SDK and the local Claude Code CLI (Superseded)](0004-codex-sdk-and-claude-cli.md)
- [ADR-0005: Define the OBSERVE security boundary](0005-observe-security-boundary.md)
- [ADR-0006: Use structured deliberation](0006-structured-deliberation.md)
- [ADR-0007: Use hardened local agent CLIs](0007-hardened-local-agent-clis.md)
- [ADR-0008: Use allowlisted provider model selections](0008-allowlisted-provider-model-selections.md)

## Adding a record

Use the next four-digit number and a short descriptive filename. Include `Status`, `Date`, `Context`, `Decision`, `Alternatives considered`, `Reasons`, `Consequences`, and `Revisit when`. Prefer one reversible decision per record. Supersede an accepted record with a new record rather than silently rewriting its outcome; update this index to link both records.

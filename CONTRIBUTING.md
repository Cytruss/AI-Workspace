# Contributing

Use Node 22+, pnpm, and English-only public source, configuration, errors, and documentation. Install with `pnpm install --frozen-lockfile`.

Follow TDD: write a focused failing test, observe the expected failure, implement the smallest safe change, then run `pnpm format`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build`. Keep changes surgical and use ADRs in `docs/decisions/` for durable architecture decisions.

Never add secrets, personal paths, Discord identifiers, application-specific data, cloud persistence, semantic memory, plugins, web UI, or write-capable execution. Preserve the OBSERVE-only security boundary and direct shell-free process execution.

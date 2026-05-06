# Building from source

Code UX is a TypeScript monorepo with a server (`src/`), a Preact dashboard (`dashboard/`), and an extensive test suite (`tests/`).

This page covers cloning, building, running, and contributing.

## Prerequisites

- **Node.js 22 LTS+** — The project targets Node 22 in CI and uses ES2022 / NodeNext modules.
- **pnpm 10.33+** — The package manager declared in `packageManager`.
- **Git ≥ 2.30**.
- **(Optional) Docker** — for testing virtual workers in DOCKER mode and sprint preview browsers.

## Clone & install

```bash
git clone https://github.com/numnx/jules-subagents-mcp.git
cd jules-subagents-mcp
pnpm install
```

`pnpm install` will hydrate `node_modules/` plus the dashboard's transitive deps. The repo uses `pnpm.overrides` to lock a few transitive vulnerabilities — leave those alone.

## Set up env

```bash
cp .env.example .env
# edit .env to set JULES_API_KEY (at minimum)
```

## Build

The full build (server + dashboard):

```bash
pnpm run build
```

This is equivalent to:

```bash
tsc --incremental --tsBuildInfoFile .cache/tsc/root.tsbuildinfo
tsc -p dashboard/tsconfig.json --noEmit --incremental --tsBuildInfoFile .cache/tsc/dashboard.tsbuildinfo
vite build
```

Outputs:

- Server: `dist/` (compiled JS).
- Dashboard: `dashboard/dist/` (Vite bundle).

Granular scripts:

```bash
pnpm run build:server      # tsc only
pnpm run build:dashboard   # vite build
```

## Run from source

Without rebuilding, using `ts-node`:

```bash
pnpm run dev
```

This boots `src/index.ts` directly. Useful for iteration on the server side.

For the dashboard with HMR:

```bash
pnpm run dev:dashboard
```

This starts Vite at the dashboard port with hot module reload. The dashboard expects an API server at the same origin — typically you also run `pnpm run dev` (or a built server) in another terminal.

## Run after build

```bash
node dist/index.js --api-key YOUR_KEY
```

Or `pnpm start`.

## Global link (for testing the binary)

```bash
pnpm link --global
jules-subagents --help
```

## Project structure

```
src/
├── index.ts                  # CLI entry
├── app/                      # lifecycle, dependency factory
├── config/                   # CLI flag + env parsing
├── contracts/                # shared types, MCP tool definitions
├── domain/sprint/            # orchestrator (cycle runner, watch loop, CI gate)
├── git/                      # branch schemes, tracking
├── infrastructure/repositories/   # markdown parsers
├── instructions/             # markdown templates
├── integrations/             # Jules API client
├── mcp/                      # MCP server, request router, tool handlers
├── repositories/             # settings, agents, memory, project
├── server/                   # Express dashboard server, routes, websocket
├── services/                 # virtual-worker-service, sprint-markdown-service, etc.
├── shared/                   # config search paths, common utils
├── sprint/                   # cycle steps (start-ready-tasks, etc.)
└── worker/                   # worker-mode entry (reserved)

dashboard/
├── index.html
└── src/
    ├── main.tsx              # Preact entry
    ├── v2/                   # current dashboard pages & components
    ├── hooks/                # legacy hooks (some still used)
    ├── lib/                  # API client, realtime client, utils
    ├── styles.css
    └── types.ts

tests/
├── backend/                  # server tests
└── dashboard/                # dashboard tests
```

## Type system

- TypeScript `strict` mode. `any` is disallowed unless documented.
- Target `ES2022`; module resolution `NodeNext`.
- Imports require explicit `.js` extension (because of `NodeNext`):

  ```ts
  import { foo } from "./bar.js";   // even though bar.ts is the source
  ```

- All public functions need explicit return types (`@typescript-eslint/explicit-function-return-type` analog enforced via review).

## Useful scripts

```bash
pnpm run typecheck             # tsc --noEmit (server)
pnpm run typecheck:dashboard   # tsc --noEmit (dashboard)
pnpm run lint                  # alias for typecheck (no eslint shipped)
pnpm test                      # vitest run (full suite)
pnpm run test:backend          # backend only
pnpm run test:dashboard        # dashboard only
pnpm run test:coverage         # full coverage report
pnpm run test:backend:coverage # backend coverage with threshold gate
pnpm run ci                    # local CI: lint + backend coverage + dashboard tests + build
pnpm run audit                 # pnpm audit --audit-level=high
pnpm run smoke-test            # node dist/index.js --help
```

## Contributing workflow

1. **Branch** — create `feat/<scope>`, `fix/<scope>` or `chore/<scope>`. Never commit directly to `main`.
2. **Implement** — keep PRs small (target < 400 LOC excluding generated files).
3. **Test** — every behavioural change needs a Vitest case. Maintain coverage thresholds (see [Testing](./testing.md)).
4. **Validate locally** — `pnpm run ci` is the equivalent of CI. Pass it before pushing.
5. **Open a PR** — Conventional Commit format, link issue, include verification steps. Use `gh pr create` if you have GitHub CLI.
6. **Review** — Both inline and conversation comments must be addressed before merge. Use 👀 / ✅ reactions to track review state.
7. **Merge** — only after all required CI checks are green.

## Common pitfalls

- **Forgetting `.js` in imports** → TypeScript silently compiles, but Node fails at runtime. Always import `from "./mod.js"`.
- **Editing `dist/`** — never. Edit `src/` and rebuild.
- **Leaving `pnpm-lock.yaml` and `package-lock.json` out of sync** — only `pnpm-lock.yaml` is authoritative. The `package-lock.json` exists for npm-published-package compatibility but should not be edited by hand.
- **Not pruning `.cache/tsc/`** — incremental TS state can go stale after large refactors. `rm -rf .cache/tsc` if you see weird type errors.

## Release process

Releases are cut from `main` via tags:

```bash
# bump version in package.json
git tag v1.2.3
git push origin v1.2.3
```

The CI tag pipeline runs the full build, runs the audit, and publishes to npm.

## Development tips

- Use `pnpm run dev` + `pnpm run dev:dashboard` in two terminals for the fastest iteration loop.
- The MCP stdio server only activates if stdin is not a TTY. To exercise it locally, pipe a JSON-RPC request: `echo '{"jsonrpc":"2.0","id":1,"method":"initialize"}' | node dist/index.js`.
- For one-off MCP integration tests, the `--mcp-http` flag plus `curl` is the simplest harness.

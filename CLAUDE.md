# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Code UX** (`@codeuxai/codeux`, bin `codeux`) is a local-first, MIT-licensed, container-first
agentic coding runtime. It turns a feature/refactor/migration/QA/CI-repair goal into a managed
**sprint**: planned into a dependency-aware DAG of tasks, routed to a provider, executed in isolated
Docker workspaces, gated through Git/CI, and surfaced in a live Preact dashboard.

The runtime ships three ways from one codebase: the **CLI/server** (`codeux`), an **Electron desktop
app**, and an **MCP server** (stdio + optional HTTPS worker gateway) so MCP-aware clients can drive
it. The same backend powers all three.

Key distinction from older docs: this is **no longer just a Jules MCP server**. Jules is one of
several providers. Local CLI providers (Gemini, Codex, Claude Code, Qwen, OpenCode, Antigravity) run
in Docker-backed workspaces; Jules is the one hosted provider.

## Commands

Package manager is **pnpm** (`pnpm@10.33.0`), Node **22+**. Use `pnpm`, not `npm`.

```bash
pnpm run dev            # Run server from source (node --import tsnode-register.mjs src/index.ts)
pnpm run build          # tsc (server) + tsc dashboard typecheck + vite build
pnpm start              # Run compiled dist/index.js
pnpm test               # Vitest single run (all suites)
pnpm run test:backend   # Backend suites only (tests/backend)
pnpm run test:dashboard # Dashboard suites only
pnpm run test:watch     # Vitest watch mode
pnpm test tests/backend/smoke.test.ts   # Single test file
pnpm run test:coverage  # Coverage with threshold enforcement
pnpm run typecheck      # tsc --noEmit (alias: lint — same command)
pnpm run ci             # lint + test:backend:coverage + test:dashboard + build
pnpm run audit          # pnpm audit --audit-level=high
```

Electron: `pnpm run electron:dev`, `pnpm run electron:dist[:linux|:mac|:win]`.

Coverage thresholds (vitest.config.ts, ratchet-only — never lower): lines 73.2%, functions 67.5%,
branches 61.13%, statements 72.0%. `src/server/activity-cache-service.ts` has a separate 80% line
gate. CI runs on Node 22: lint → backend coverage → dashboard tests → build → audit.

## Architecture

```
Code UX backend (src/server/code-ux-server.ts)
├── Entry points
│   ├── src/index.ts            — CLI + MCP server (dashboard by default)
│   ├── src/worker/index.ts     — worker-host mode
│   └── src/electron/main.ts    — Electron desktop shell
├── HTTP/dashboard server (src/server/) — Express routes + realtime WebSocket
├── MCP (src/mcp/, src/api/mcp/) — tool registry, handlers, stdio + HTTPS worker gateway
├── Domain (src/domain/)
│   ├── sprint/ — orchestrator/, ci/, composer/, tasks/, branch + merge state
│   ├── projects/, workers/, planning/, qa-review/, quicksprint/, scheduler/
│   ├── sessions/, settings/, llm/, jules/, user/
├── Sprint orchestration loop (src/sprint/)
│   ├── sprint-orchestrator.ts + steps/ (preflight, load-subtasks, start-ready-tasks,
│   │   qa-review, completion, status-derivation, protocol)
│   └── orchestrator/: cycle-runner, watch-loop-runner, watch-loop-state-machine,
│       sprint-run-heartbeat, sprint-state-evaluator
├── Services (src/services/) — provider execution, CLI workflow, QA, memory, embeddings,
│   docker lifecycle, sprint preview, planning agent, scheduler, knowledge, git status, …
├── Infrastructure (src/infrastructure/)
│   ├── providers/cli/ — Docker runner, workspace manager, PR service, provider command specs,
│   │   credential mounts, telemetry/usage watchers
│   └── git/ — host CLI, local-git (no-origin) merge, status policy, remote repo creation
├── Repositories (src/repositories/) — data access over SQLite
│   └── db/ — schema, migrations, database-adapter, sqlite-database-adapter, sql-dialect
├── Contracts (src/contracts/) — shared domain types
└── Dashboard (dashboard/src/) — Preact + Tailwind v4 (v2/ holds current UI), served on :4444
```

### Data storage

Runtime state lives in **SQLite at `~/.code-ux/app.db`** (WAL mode), accessed via Node's built-in
`node:sqlite` (`DatabaseSync`) — there is no `sqlite3` CLI; query with `node:sqlite`. Tests use an
in-memory DB (`VITEST_IN_MEMORY_DB=true`). Per-repo runtime artifacts (sprint subtasks as markdown,
debug logs, agents, quicksprints) live in a `.code-ux/` directory inside each managed project; global
assets live under `~/.code-ux/`.

### Key design decisions

- **Constructor-based DI** via factory classes in `src/app/dependency-factory/` (core, dashboard,
  mcp, sprint factories).
- **Repository pattern** for all data access; sprint subtasks round-trip to markdown with YAML
  frontmatter for portability.
- **ESM throughout** (`"type": "module"`, NodeNext resolution). Imports use `.js` extensions even for
  `.ts` sources.
- **Docker-first execution**: provider CLIs run in short-lived Docker workspaces; host execution is an
  opt-in fallback. Stale containers/workspaces/previews are pruned on startup.
- **MCP dual transport**: stdio for local clients; optional HTTPS gateway (`--mcp-https`, on by
  default) for remote worker hosts.
- **Live Browser previews**: one container per sprint, proxied at `preview-<id>.localhost` through the
  dashboard (cross-origin iframe; no X-Frame-Options). See `docs/dashboard/browser-preview.md`.

### Type system

Core domain types live in `src/contracts/` (`app-types.ts` and topic-specific files). TypeScript is
strict, `ES2022` target, `NodeNext` resolution.

## Testing

Tests are in `tests/` (and dashboard `__tests__/`) mirroring `src/`. Vitest with `vi.mock()` for
module mocking and `vi.spyOn()` for verification. Default environment is Node; UI tests opt into jsdom
via `@vitest-environment jsdom` pragmas. React is aliased to `preact/compat` in vitest + vite config.

## Configuration

Providers and credentials are configured **from the dashboard**, not env vars — Code UX can start
with no keys. Config search path: CLI args → env vars → CWD `.code-ux/` → project root → home dir.

Key env vars: `JULES_API_KEY` (only for the Jules provider), `DASHBOARD_PORT` (default 4444),
`MCP_HTTPS_ENABLED` (default true), `MCP_HTTPS_PORT`, `MCP_HTTPS_HOST`, `MCP_HTTPS_PATH`,
`MCP_HTTPS_AUTH_TOKEN`.

CLI flags (`codeux --help`): `--api-key`, `--runtime-role` (project_manager | worker-host),
`--headless` (MCP-only, no dashboard), `--mcp-https` / `--no-mcp-https`, `--mcp-https-port`,
`--mcp-https-host`, `--mcp-https-path`, `--mcp-https-auth-token`.

## Local dev access (this environment)

In this working environment you have broad latitude to operate the running system directly:

- **Full access to the database and environment.** The runtime DB is `~/.code-ux/app.db` (SQLite,
  WAL) — read and write it as needed via `node:sqlite`. You may inspect/modify environment state.
- **You may restart the dev server on port 4444 anytime.** The dashboard/backend runs there; restart
  it whenever a change needs to take effect (e.g. `pnpm run dev`).
- **You may run test sprints in the project "Simple Test 2".** It is wired to a local model
  specifically for testing, so dispatching sprints/tasks there is safe and expected. Use it for
  end-to-end orchestration checks; don't run experimental sprints against real projects.

## Conventions

- Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`). **`dev` is the integration branch** —
  branch off `dev` and open PRs **into `dev`** (not `main`) after CI passes; use `gh` for PR workflow.
- Remotes: `origin` is the **`numnx/codeux` fork** — push feature branches there and target it for
  PRs. `upstream` is `codeux-ai/codeux` (do not push/PR there unless asked).
- 2-space indent, `camelCase` vars/functions, `PascalCase` types/components. Strict typing — avoid
  `any`. No new plain-JS modules. Tailwind is the only styling approach; don't add UI frameworks.
- Documentation source of truth is `docs/` (entrypoint `docs/index.md`, index `docs/SUMMARY.md`).
  `docs-web/` holds the published user/developer/architecture docs referenced from the README. Update
  the affected docs page when you change behavior; add a new page + link it for new subsystems.

## Reference docs

- README.md — product overview, providers, install, run-from-source.
- AGENTS.md — collaboration workflow, PR review protocol, quality guardrails.
- STYLEGUIDE.md — dashboard design system rules.
- docs/architecture/system-overview.md, docs/architecture/repository-map.md — deeper architecture.
- docs/sprint-loop/atomic-loop.md — the orchestration loop.
- docs/mcp/tools-and-contracts.md, docs/mcp/runtime-and-dispatch.md — MCP surface.
</content>

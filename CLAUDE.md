# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

MCP server for the Jules Agent API. Orchestrates multi-agent sprints — planning tasks, dispatching to virtual workers (Gemini/Claude/Codex), monitoring CI, and auto-merging PRs. Includes a live Preact dashboard.

## Commands

```bash
npm run build          # TypeScript + dashboard (tsc && vite build)
npm run dev            # Run from source (ts-node-esm)
npm test               # Vitest single run
npm run test:watch     # Vitest watch mode
npm test -- tests/backend/smoke.test.ts  # Single test file
npm run test:coverage  # Coverage with threshold enforcement
npm run typecheck      # tsc --noEmit
npm run ci             # typecheck + lint + test (local CI)
```

Coverage thresholds: lines 80%, functions 69%, branches 64%, statements 80%. `activity-cache-service.ts` has a separate 80% line coverage gate.

CI runs on Node 22: test → coverage → build → audit.

## Architecture

```
MCP Server (stdio + optional HTTP)
├── Core Tool Handler (src/mcp/core-tool-handler.ts) — 12+ MCP tools
├── Sprint Orchestrator (src/domain/sprint/)
│   ├── cycle-runner.ts — task scheduling & dependency resolution
│   ├── watch-loop-runner.ts — continuous monitoring
│   ├── sprint-action-runner.ts — plan/status/orchestrate actions
│   └── ci/ — feature PR gates, auto-merge policies
├── Virtual Worker Service (src/services/virtual-worker-service.ts)
│   └── On-demand agent provisioning in Docker containers
├── Jules API Client (src/integrations/jules-api-client.ts) — REST via axios
├── Repositories (src/repositories/) — file-based data access
├── Dashboard (dashboard/src/) — Preact + Tailwind v4, served on :4444
└── Entry Points
    ├── src/index.ts — main CLI + MCP server
    └── src/worker/index.ts — worker-mode entry
```

### Key Design Decisions

- **Constructor-based DI** with factory classes (`src/app/dependency-factory.ts`)
- **Repository pattern** for all data access (subtasks stored as markdown with YAML frontmatter)
- **ESM throughout** (`"type": "module"`, NodeNext resolution, `.js` extensions in imports)
- **Config search path**: CLI args → env vars → CWD `.jules-subagents/` → project root → home dir
- **Dual MCP transport**: stdio for local, optional HTTP gateway for remote workers

### Type System

Core domain types live in `src/contracts/app-types.ts`. TypeScript is strict mode with `ES2022` target and `NodeNext` module resolution. Imports require `.js` extensions even for `.ts` files.

## Testing

Tests are in `tests/` mirroring `src/` structure. Uses Vitest with `vi.mock()` for module mocking and `vi.spyOn()` for verification. Test environment is Node (not jsdom).

## Configuration

Key env vars: `JULES_API_KEY` (required), `DASHBOARD_PORT` (default 4444), `MCP_HTTP_ENABLED`, `MCP_HTTP_PORT`, `MCP_HTTP_AUTH_TOKEN`.

CLI flags: `--api-key`, `--runtime-role` (project_manager|worker-host), `--headless`, `--mcp-http`, `--mcp-http-port`, `--mcp-http-host`, `--mcp-http-auth-token`.

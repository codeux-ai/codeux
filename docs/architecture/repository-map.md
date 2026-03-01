# Repository Map

This map explains where major responsibilities live.

## Top-Level Layout

```text
.
├─ src/                        # Backend MCP server and orchestration engine
├─ tests/                      # Dedicated backend + dashboard test suites
├─ dashboard/                  # Preact dashboard app
├─ .jules-subagents/           # Local default guides + instruction templates
├─ docs/                       # Project documentation
├─ dist/                       # Compiled backend output
└─ package.json                # Scripts and dependencies
```

## Backend (`src/`)

- `index.ts`
  - Minimal bootstrap (`dotenv`, app config, server launch).
- `config/`
  - `app-config.ts`, `external-settings.ts`
  - Startup/env config loading and external settings hints.
- `contracts/`
  - `app-types.ts`, `mcp-tool-definitions.ts`
  - Shared backend contracts and MCP tool definitions.
- `integrations/`
  - `jules-api-client.ts`
  - Jules API HTTP client.
- `server/`
  - `jules-agent-server.ts`
  - Main runtime composition and MCP server class.
  - `mcp-request-router.ts`
  - MCP list/call handler registration and dispatch routing.
  - `activity-cache-service.ts`
  - Live-activity + git-status caching for dashboard endpoints.
  - `dashboard-server.ts`
  - Express routes for dashboard APIs and static assets.
- `repositories/`
  - `settings-repository.ts`
  - `settings-defaults.ts`
  - `settings-sanitizer.ts`
  - `settings-db-storage.ts`
  - `guide-repository.ts`
  - `subtask-repository.ts`
  - `session-tracking-repository.ts`
- `mcp/`
  - `core-tool-handler.ts`
  - `agent-tool-handler.ts`
- `services/`
  - `task-service.ts`
  - `git-status-service.ts`
  - `cli-workflow-service.ts`
  - `cli-process-runner.ts`
  - `cli-docker-utils.ts`
  - `cli-workflow-text-utils.ts`
  - `cli-workflow-utils.ts`
  - `provider-routing.ts`
- `git/`
  - `sprint-branch-scheme.ts`
- `sprint/sprint-orchestrator.ts`
  - Main sprint orchestration coordinator.
- `sprint/sprint-types.ts`
  - Shared sprint orchestration argument/result contracts.
- `sprint/action-required-automation.ts`
  - Action-required session automation policy and intervention handlers.
- `sprint/ci-status-utils.ts`
  - Shared CI status/failure summarization helpers used by sprint logic.
- `sprint/steps/`
  - Atomic step modules used by orchestrator.
- `instructions/`
  - Template loading, fallback, and placeholder rendering.

## Dashboard (`dashboard/src/`)

- `app.tsx`
  - Main view orchestration and polling.
- `components/`
  - UI pieces (`SettingsPage`, `TaskCard`, `ActivitySidebar`, etc.).
- `lib/`
  - Frontend helpers (`settings`, `status`, `activity`, `markdown`).
- `types.ts`
  - Dashboard-side type contracts.

## Local Configuration and Templates (`.jules-subagents/`)

- `agents/`
  - `worker.md`, `orchestrator.md`, `watch.md`, `git_manager*.md`, etc.
- `instructions/`
  - Organized sprint-loop templates (guards/planning/protocol/watch/cleanup).
- `sprints/`
  - Runtime sprint plans and generated subtask markdown files.

## Documentation (`docs/`)

- `index.md`
  - Documentation home.
- Topic folders (`mcp/`, `sprint-loop/`, `dashboard/`, etc.)
- `yourdocs.md`
  - Atomic refactor notes and migration details.

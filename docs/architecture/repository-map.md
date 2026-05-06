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
- `api/mcp/`
  - `tool-registry.ts`
  - Typed MCP tool argument contracts and register/dispatch registry.
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
  - `execution-repository.ts`
  - Delegates snapshot projection to `execution/project-execution-snapshot-query.ts` while keeping validation boundary.
  - `execution/execution-invocations-query.ts`
  - Focused query module separating invocation and message lists from write concerns.
  - `execution/execution-stats-types.ts`
  - Dedicated module for stats query types to decouple queries from the main execution repository.
  - `settings-repository.ts`
  - `settings-defaults.ts`
  - `settings-sanitizer.ts`
  - `settings-db-storage.ts`
  - `guide-repository.ts`
  - `subtask-repository.ts`
  - `session-tracking-repository.ts`
- `infrastructure/repositories/`
  - `file-template-repository.ts`
  - Shared file lookup implementation used by guide and instruction template repositories.
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
- `shared/logging/`
  - `logger.ts`
  - `correlation-id.ts`
- `git/`
  - `sprint-branch-scheme.ts`
- `sprint/sprint-orchestrator.ts`
  - Main sprint orchestration coordinator.
- `sprint/sprint-types.ts`
  - Shared sprint orchestration argument/result contracts.
- `domain/sprint/orchestrator/`
  - Action runners, loop runners, and state machines.
- `domain/sprint/ci/`
  - CI merge gates, automerge policy, and failure summarization.
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

## Local Configuration and Templates (`.code-ux/`)

- `agents/`
  - project/home/default agent markdown mirrors such as `planning_agent.md` and `worker.md`
- `sprints/`
  - Runtime sprint plans and generated subtask markdown files.

## Documentation (`docs/`)

- `index.md`
  - Documentation home.
- Topic folders (`mcp/`, `sprint-loop/`, `dashboard/`, etc.)
- `yourdocs.md`
  - Atomic refactor notes and migration details.

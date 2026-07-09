# Repository Map

This map explains where major responsibilities live.

## Top-Level Layout

```text
.
├─ src/                        # Backend MCP server and orchestration engine
├─ tests/                      # Dedicated backend + dashboard test suites
├─ dashboard/                  # Preact dashboard app
├─ .code-ux/                   # Local configuration, artifacts, and templates
├─ docs/                       # Project documentation
├─ dist/                       # Compiled backend output
└─ package.json                # Scripts and dependencies
```

## Backend (`src/`)

Source trees are intentionally kept free of editor and merge backup artifacts. Files ending in
`.orig` are ignored under `src/` and `dashboard/src/`, and repository hygiene tests fail if those
backup files appear there.

- `index.ts`
  - Minimal bootstrap (`dotenv`, app config, server launch).
- `electron/`
  - `main.ts`
  - Desktop shell entrypoint and network policy, which hosts the Code UX UI without owning backend orchestration.
- `worker/`
  - Headless execution role entrypoint for worker-host mode.
- `config/`
  - `app-config.ts`, `external-settings.ts`
  - Startup/env config loading and external settings hints.
- `api/mcp/`
  - `tool-registry.ts`
  - Typed MCP tool argument contracts and register/dispatch registry.
- `contracts/`
  - `app-types.ts`, `mcp-tool-definitions.ts`
  - Shared backend contracts and MCP tool definitions.
  - `chat-provider-types.ts`
  - External chat provider setup schemas, redacted credential contracts, channel binding records, and message delivery state types.
- `integrations/`
  - `jules-api-client.ts`
  - Jules API HTTP client.
- `server/`
  - `code-ux-server.ts`
  - Main runtime composition wiring backend services (dashboard API on default port 4444 and MCP server).
  - `mcp-request-router.ts`
  - MCP list/call handler registration and dispatch routing.
  - `activity-cache-service.ts`
  - Live-activity + git-status caching for dashboard endpoints.
  - `dashboard-server.ts`
  - Express routes for dashboard APIs and static assets.
- `repositories/`
  - Persistence using SQLite via `node:sqlite`.
  - `execution-repository.ts`
  - Delegates snapshot projection to `execution/project-execution-snapshot-query.ts` while keeping validation boundary. The snapshot query owns shared sprint-run/task ID deduplication before invoking bounded slice queries and usage/wall-time enrichment.
  - `execution/execution-invocations-query.ts`
  - Focused query module separating invocation and message lists from write concerns. Its live snapshot slice merges bounded project-recent, selected-sprint, and expanded-run rows by invocation ID while preserving recency order.
  - `execution/execution-runtime-events-query.ts`
  - Focused runtime-event live snapshot slice that merges bounded project-recent, selected-sprint, and expanded-run event rows by event ID without changing the dashboard response contract.
  - `execution/execution-stats-types.ts`
  - Dedicated module for stats query types to decouple queries from the main execution repository.
  - `project-runtime/run-event-writes.ts`
  - Focused write module for legacy runtime status-sync task runs and task-run events, including candidate run matching, status-sync event signatures, denormalized `task_run_events.project_id`, and source event key deduplication.
  - `chat-provider-repository.ts`
  - External chat connector connections, channel bindings, inbound message idempotency, and outbound delivery state.
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
- `infrastructure/providers/cli/`
  - Docker and host CLI provider implementations for task execution.
  - `invocation-workspace-preparer.ts`
  - Shared Docker invocation workspace boundary for snapshot checkout construction, git policy normalization, fresh/continue lifecycle options, remote-only materialization in `REMOTE` git mode, and continuation workspace resolution.
- `mcp/`
  - `core-tool-handler.ts`
  - `agent-tool-handler.ts`
- `services/`
  - `task-service.ts`
  - `git-status-service.ts`
  - `sprint-issue-service.ts`
  - `jira-api-client.ts`
  - Linked issue search and prompt-context loading for GitHub, GitLab, and Jira using saved integration settings.
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

## Dashboard (`dashboard/src/v2/`)

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
- `conversations/<thread-id>/session-title.md`
  - Project-local dashboard chat session title mirror. New dashboard chat threads derive a concise title from the first visible user message, and manual title edits update this file alongside the sqlite thread record.

## Documentation (`docs/`)

- `index.md`
  - Documentation home.
- Topic folders (`mcp/`, `sprint-loop/`, `dashboard/`, etc.)
- `yourdocs.md`
  - Atomic refactor notes and migration details.

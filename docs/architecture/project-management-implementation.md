# Project Management Implementation

This page describes the first shipped slice of the Code UX project-management refactor.

## Scope

This implementation moves the v2 dashboard onto a database-backed `project -> sprint -> task` model.

It includes:
- Code UX app database tables in `~/.code-ux/app.db`
- typed project/sprint/task repositories
- selected-project persistence in sqlite
- project-scoped dashboard HTTP endpoints
- v2 dashboard wiring for Projects, Sprints, Tasks, top-nav selection, and overview widgets
- a structured import flyout supporting markdown import (and placeholders for future providers like Jira), plus export for sprints and tasks
- selected-project runtime projection for live dashboard status
- DB-backed project-scoped Agents and Chat pages
- first listen-loop MCP connection and conversation contracts
- first DB-native sprint orchestration slice for project/sprint scope
- `manage_code_ux` MCP tool handlers for projects and sprints domain actions

It does not yet include:
- multi-MCP scheduling
- worker task pickup
- autonomous task assignment across multiple MCPs
- persisted provider activity transcripts in `task_run_events`

## Source Of Truth

Project management state now lives in sqlite, not markdown files.

Primary implementation files:
- `src/repositories/app-db-storage.ts`
- `src/repositories/project-management-repository.ts`
- `src/services/sprint-markdown-service.ts`
- `src/services/sprint-execution-state-service.ts`
- `src/services/sprint-task-dispatch-service.ts`
- `src/server/dashboard-server.ts`
- `src/mcp/management-tool-handler.ts`
- `src/mcp/management/project-actions.ts`
- `src/mcp/management/sprint-actions.ts`
- `dashboard/src/v2/context/project-data.tsx`
- `dashboard/src/v2/lib/project-api.ts`

Markdown is now a transport format for import/export:
- sprint metadata is parsed by `SprintMarkdownService`
- task markdown uses `SubtaskParser`

## Data Model

Phase-1 tables used by the new flow:
- `projects`
- `project_sources`
- `sprints`
- `tasks`
- `task_dependencies`
- `app_settings`

Future-facing tables already exist in the same DB for follow-up work:
- `mcp_connections`
- `connection_project_bindings`
- `sprint_runs`
- `task_dispatches`
- `execution_leases`
- `task_runs`
- `task_run_events`
- `conversation_threads`
- `conversation_messages`

Selected project state is persisted under `app_settings.selected_project_id`.

## API Surface

The dashboard now has project-scoped CRUD endpoints:

- `GET /api/projects`
- `POST /api/projects`
- `GET /api/projects/:projectId`
- `PATCH /api/projects/:projectId`
- `DELETE /api/projects/:projectId`
- `PUT /api/projects/:projectId/select`
- `GET /api/projects/:projectId/sprints`
- `POST /api/projects/:projectId/sprints`
- `POST /api/projects/:projectId/sprints/import`
- `GET /api/projects/:projectId/sprints/:sprintId/export`
- `PATCH /api/sprints/:sprintId`
- `DELETE /api/sprints/:sprintId`
- `GET /api/projects/:projectId/tasks`
- `POST /api/projects/:projectId/tasks`
- `PATCH /api/tasks/:taskId`
- `DELETE /api/tasks/:taskId`
- `GET /api/projects/:projectId/connections`
- `PATCH /api/connections/:connectionId`
- `GET /api/projects/:projectId/conversations/threads`
- `POST /api/projects/:projectId/conversations/threads`
- `GET /api/conversations/threads/:threadId/messages`
- `POST /api/projects/:projectId/conversations/messages`
- `GET /api/projects/:projectId/execution/invocations`
- `GET /api/execution/invocations/:invocationId/messages`

Legacy runtime endpoints still exist for the old live runtime/status surfaces:
- `GET /api/status`
- `GET /api/live-activities`
- `GET /api/git-status`
- `POST /api/tasks/:taskId/rerun`

Those endpoints are now selected-project scoped through sqlite-backed runtime projection rather than directly reading `runtimeContext.lastStatus`.

## Dashboard Behavior

The v2 dashboard now uses the selected project as the scope driver.

Current behavior:
- Top navigation project selector reads/writes the selected project in sqlite
- Top navigation sprint selection remains a persisted management/view preference
- The Live page now follows that selected sprint for display scope, but runtime execution still resolves from active sprint runs so the header selection does not interfere with parallel sprint execution
- Projects page creates, lists, selects, and deletes projects
- Sprints page creates and lists sprints for the selected project
- Sprint list/status views derive their effective sprint state from the latest `sprint_run`, so paused or cancelled runs do not continue to render as running
- Sprints page run controls now operate on project-scoped execution data and update sprint cards optimistically while the execution snapshot refreshes
- Sprints page can import markdown bundles and export DB-backed sprint/task markdown bundles
- sprint creation now normalizes stale or non-increasing client-provided sprint numbers to the next project number, while still preserving explicitly provided future numbers above the current project max
- Tasks page creates, edits, deletes, filters, and groups tasks for the selected project
- Tasks page sprint deep links now apply a local page filter instead of silently overwriting the persisted selected sprint for the whole project
- Task dependencies are edited in the task modal and stored in `task_dependencies`
- Dashboard overview project/task widgets and header stats read from the same DB-backed state
- Agents page manages project-scoped agent presets rather than live MCP connections
- Chat page lists sqlite-backed conversation threads/messages for the selected project
- Dashboard messages are queued for listeners through the same sqlite model
- planning flows include interactive, background-safe, and dismissible planning overlays with cancellation support
- quicksprint execution flows are now mutually exclusive with composer create/edit states to maintain focus
- quicksprint built-ins are now grouped by purpose in the dashboard, with `Fullstack JS App` as the initial default template set
- the sprint ledger uses a refreshed glass ledger row treatment with explicit filter controls for status, showcase, and QA alongside real-time client-side search
- sprint ledger row actions are rendered through a viewport-level overlay so the edit/action menu stays anchored to the trigger across transformed page sections and scroll containers
- internal sprint orchestration resolves project/sprint scope from sqlite instead of markdown task directories
- orchestrate executions now create `sprint_runs`, `task_dispatches`, and `task_runs`
- orchestrate executions now hold a sprint-scoped execution lease while the loop is active
- dashboard reruns now create DB-backed dispatches and task runs instead of directly bypassing execution state

## Markdown Round-Trip

Sprint import:
- accepts sprint markdown plus a list of task markdown documents
- creates sprint and task rows in sqlite
- resolves task dependencies after task creation

Sprint export:
- emits one sprint markdown document
- emits one markdown file per task
- converts dependency IDs back to task keys for deterministic export

## Known Boundaries

Current task records are now both management records and the source planning graph for execution.

Current boundary:
- task readiness is derived from DB tasks and dependencies
- ready-task launches create dispatch and run rows in sqlite
- CI/protocol logic still operates on the projected `Subtask` runtime shape
- live activity messages are still fetched directly from provider sessions at request time
- reruns and worker pickup still need to move onto the dispatch model

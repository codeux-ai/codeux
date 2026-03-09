# Project Management Implementation

This page describes the first shipped slice of the Sprint OS project-management refactor.

## Scope

This implementation moves the v2 dashboard onto a database-backed `project -> sprint -> task` model.

It includes:
- Sprint OS app database tables in `~/.sprint-os/app.db`
- typed project/sprint/task repositories
- selected-project persistence in sqlite
- project-scoped dashboard HTTP endpoints
- v2 dashboard wiring for Projects, Sprints, Tasks, top-nav selection, and overview widgets
- markdown import/export for sprints and tasks
- selected-project runtime projection for live dashboard status
- DB-backed project-scoped Agents and Chat pages
- first listen-loop MCP connection and conversation contracts

It does not yet include:
- DB-native sprint execution
- sprint runs and task dispatch records
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
- `src/server/dashboard-server.ts`
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
- Projects page creates, lists, selects, and deletes projects
- Sprints page creates and lists sprints for the selected project
- Sprints page can import markdown bundles and export DB-backed sprint/task markdown bundles
- Tasks page creates, edits, deletes, filters, and groups tasks for the selected project
- Task dependencies are edited in the task modal and stored in `task_dependencies`
- Dashboard overview project/task widgets and header stats read from the same DB-backed state
- Agents page lists sqlite-backed MCP connections bound to the selected project
- Chat page lists sqlite-backed conversation threads/messages for the selected project
- Dashboard messages are queued for listeners through the same sqlite model

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

Current task records are management records, not yet full execution records.

That means:
- task status is managed in the DB for CRUD and planning workflows
- live execution state is mirrored from the legacy orchestrator into `task_runs` and project runtime context
- live activity messages are still fetched directly from provider sessions at request time
- the next execution refactor must replace the legacy file-based sprint loop instead of layering another compatibility bridge on top of it
- future work should attach MCP connection roles, dispatch state, and executor selection to these same runtime entities instead of creating a second model

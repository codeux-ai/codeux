# Sprint OS Phase 1 Implementation Plan

## Status
Accepted implementation plan

## Purpose
This document converts the Sprint 4 direction into an execution-ready plan for the first implementation phase of the Sprint OS refactor.

The goal of phase 1 is to establish a stable project management foundation:

- rename runtime/config ownership from `.jules-subagents` to `.sprint-os`
- move project, sprint, and task state into sqlite
- keep markdown as import/export compatibility only
- wire the v2 dashboard to real project-scoped data
- reserve the correct contracts for future multi-MCP connection roles and listen mode

This phase does not attempt to ship the full worker model, live chat routing, or concurrent multi-project execution.

## Current Constraints
The current codebase still has several hard blockers that make direct v2 integration unsafe:

- runtime status is a single in-memory `lastStatus` object
- dashboard APIs are global rather than project-scoped
- sprint/task persistence is markdown-first under repo-local `.jules-subagents/sprints`
- rerun and merge flows still write back to markdown files
- sqlite only stores dashboard settings and provider session tracking
- the v2 dashboard entity model is mock-based and not connected to the backend

## Phase 1 Outcome
At the end of phase 1, the application must support:

1. Managing projects in the v2 dashboard.
2. Managing sprints per project.
3. Managing tasks per sprint, including dependency metadata.
4. Importing sprint/task markdown into the database.
5. Exporting database-backed sprint/task state back to markdown.
6. Keeping the selected project as the scope driver for the dashboard.
7. Preserving compatibility wrappers for legacy `sprint_agent` and `task_agent` flows.

## Required Design Decisions

### 1. Sprint OS directory migration
The new runtime/config root is:

- repo-scoped: `<repo>/.sprint-os/`
- home-scoped: `~/.sprint-os/`

This replaces:

- `<repo>/.jules-subagents/`
- `~/.jules-subagents/`

Phase 1 assumes a clean break for runtime databases. Existing databases can be discarded. Markdown content may still be imported if needed.

### 2. Database as source of truth
Projects, sprints, tasks, dependencies, and runs must live in sqlite. Markdown is no longer the authoritative store.

### 3. Multi-MCP compatibility now, full worker model later
Phase 1 remains single-lane for execution safety, but the schema must not assume a single MCP connection forever.

This means phase 1 must include:

- MCP connection records
- connection role metadata
- project selection or project assignment metadata
- conversation thread/message storage for future dashboard chat and listen mode

This does not mean phase 1 must implement:

- multi-worker scheduling
- task pickup queues
- full agent dispatch between multiple live MCPs

### 4. Listen mode must be pull-friendly
The current MCP transport is stdio-based. Because of that, future listen mode must be designed around an explicit loop entrypoint such as `start_listen`, where a connected AI repeatedly polls for dashboard-directed work and re-enters the loop after replying.

## Proposed Database Foundation

### Core tables
- `projects`
- `project_sources`
- `sprints`
- `tasks`
- `task_dependencies`
- `task_runs`
- `task_run_events`
- `mcp_connections`
- `connection_project_bindings`
- `conversation_threads`
- `conversation_messages`
- `app_settings`

### Recommended minimum columns

#### `projects`
- `id`
- `slug`
- `name`
- `base_dir`
- `repo_url`
- `source_id`
- `default_branch`
- `feature_branch_prefix`
- `status`
- `created_at`
- `updated_at`

#### `sprints`
- `id`
- `project_id`
- `number`
- `slug`
- `name`
- `goal`
- `status`
- `start_date`
- `end_date`
- `feature_branch`
- `created_at`
- `updated_at`

#### `tasks`
- `id`
- `project_id`
- `sprint_id`
- `task_key`
- `title`
- `prompt_markdown`
- `description`
- `status`
- `priority`
- `sort_order`
- `is_independent`
- `is_merged`
- `merge_indicator`
- `source_type`
- `source_path`
- `created_at`
- `updated_at`

#### `task_dependencies`
- `task_id`
- `depends_on_task_id`

#### `task_runs`
- `id`
- `project_id`
- `sprint_id`
- `task_id`
- `connection_id`
- `provider`
- `mode`
- `session_id`
- `session_name`
- `state`
- `worker_branch`
- `pr_url`
- `started_at`
- `finished_at`
- `duration_ms`

#### `task_run_events`
- `id`
- `task_run_id`
- `event_type`
- `originator`
- `payload_json`
- `created_at`

#### `mcp_connections`
- `id`
- `connection_key`
- `display_name`
- `role`
- `transport`
- `status`
- `capabilities_json`
- `last_heartbeat_at`
- `created_at`
- `updated_at`

`role` should support at least:

- `PROJECT_MANAGER`
- `WORKER`
- `LISTENER`

#### `connection_project_bindings`
- `connection_id`
- `project_id`
- `is_active`
- `created_at`

#### `conversation_threads`
- `id`
- `project_id`
- `connection_id`
- `scope`
- `title`
- `status`
- `created_at`
- `updated_at`

#### `conversation_messages`
- `id`
- `thread_id`
- `direction`
- `author_type`
- `author_connection_id`
- `body_markdown`
- `delivery_status`
- `created_at`

## API Shape for Phase 1

### Required HTTP endpoints
- `GET /api/projects`
- `POST /api/projects`
- `GET /api/projects/:projectId`
- `PATCH /api/projects/:projectId`
- `DELETE /api/projects/:projectId`
- `GET /api/projects/:projectId/sprints`
- `POST /api/projects/:projectId/sprints`
- `GET /api/projects/:projectId/tasks`
- `GET /api/projects/:projectId/sprints/:sprintId/tasks`
- `POST /api/projects/:projectId/sprints/:sprintId/tasks`
- `PATCH /api/projects/:projectId/tasks/:taskId`
- `DELETE /api/projects/:projectId/tasks/:taskId`
- `POST /api/projects/:projectId/import/markdown`
- `POST /api/projects/:projectId/export/markdown`

### Required dashboard behavior
- The top nav project selector must use real projects.
- Projects page must create and list persisted projects.
- Sprints page must list and create sprints for the selected project.
- Tasks page must list and mutate tasks for the selected project and sprint.
- Agents, Chat, and Live pages may remain partially mocked in phase 1, but they must become project-scoped and align with the new backend contracts.

## Legacy Compatibility Rules
- `sprint_agent` and `task_agent` remain available during transition.
- Any touched mutation path must write through repositories first.
- Markdown file writes are limited to explicit export flows or temporary compatibility wrappers.
- Direct writes to `.jules-subagents` paths must be removed from active phase-1 paths.

## Phase 1 Backlog

### Track 0: Rebrand and path migration
- Introduce a centralized Sprint OS path helper.
- Replace `.jules-subagents` path resolution with `.sprint-os`.
- Rebrand visible product strings from Jules OS / Jules Subagents to Sprint OS where appropriate.
- Keep compatibility search fallback only where migration risk requires it.

### Track 1: Database and migrations
- Add a dedicated Sprint OS app database.
- Create initial schema and migration runner.
- Add repository test coverage for every new table family.

### Track 2: Domain repositories
- Implement `ProjectRepository`.
- Implement `SprintRepository`.
- Implement `TaskRepository`.
- Implement `TaskDependencyRepository`.
- Implement `TaskRunRepository`.
- Implement `McpConnectionRepository`.
- Implement conversation repositories for future listen mode support.

### Track 3: Markdown import/export
- Define canonical markdown import format for sprint and task records.
- Build importer with deterministic task dependency resolution.
- Build exporter with stable ordering and frontmatter serialization.
- Add round-trip tests.

### Track 4: Dashboard API
- Add project-scoped CRUD routes.
- Add validation and integration tests.
- Replace global task status assumptions in API handlers.

### Track 5: V2 dashboard integration
- Replace mock project selector data.
- Replace mock Projects page data.
- Replace mock Sprints page data.
- Replace mock Tasks page data.
- Add selected-project state to the frontend runtime.

### Track 6: Legacy orchestration bridge
- Route sprint/task reads through repositories.
- Route rerun and merged-flag writes through repositories.
- Keep markdown export available for legacy workflows that still need files.

## Explicit Non-Goals for Phase 1
- No full task pickup flow for worker MCPs.
- No full dashboard chat delivery loop to connected MCPs.
- No final telemetry analytics UI.
- No concurrent orchestration across multiple projects.
- No hard removal of legacy compatibility wrappers yet.

## Risks
- Path migration is broad and touches docs, code, tests, and user-facing instructions.
- The current dashboard runtime assumes a single global status model.
- Legacy orchestration code has many direct assumptions about sprint-number-based filesystem layout.
- Introducing DB truth without project-scoped APIs will create an awkward hybrid state.
- Listen mode will be blocked later if conversation storage is not reserved now.

## Definition of Done
- `.sprint-os` is the active runtime/config directory in changed paths.
- The application persists projects, sprints, and tasks in sqlite.
- The v2 Projects, Sprints, and Tasks pages use real backend data.
- Markdown import/export works for sprint/task records.
- Legacy orchestration paths touched in phase 1 write through repositories.
- Schema includes future-compatible MCP connection and conversation tables.

## Next Implementation Pass
The next execution pass should start with:

1. Sprint OS path abstraction and `.sprint-os` migration.
2. Initial sqlite schema and migration runner.
3. Repository scaffolding and tests for projects, sprints, tasks, dependencies, connections, and conversations.

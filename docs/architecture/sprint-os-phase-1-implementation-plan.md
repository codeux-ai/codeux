# Sprint OS Phase 1 Implementation Plan

## Status
Accepted implementation plan

## Purpose

This document defines the first implementation phase of the Sprint OS refactor after the v2 dashboard direction was finalized.

The goal is not to preserve the old prototype workflow.

The goal is to replace it with a DB-native execution foundation that matches the v2 product model:

- projects
- sprints per project
- tasks per sprint
- live execution scoped to project and sprint
- multiple active projects and multiple active sprints
- multiple executor types on one runtime model

Markdown remains import/export only.

The connection and listener model also needs a corrective reset before more multi-MCP features land. That plan is defined in [Connection And Listener Foundation Reset](./connection-and-listener-foundation-reset.md).

## Product Goal

Sprint OS must become a true project operating system, not a dashboard on top of a file-based sprint loop.

That means:

- the v2 dashboard is the operational control plane
- sqlite is the only authoritative runtime store
- `sprint_agent` is transformed into a project/sprint execution command on top of DB state
- Docker/worktree execution remains first-class
- connected MCP workers become another executor option on the same execution model
- no execution-critical behavior depends on repo-local markdown task files

## Non-Negotiable Architecture Rules

### 1. DB-native execution only

The system must not reconstruct execution state from repo-local markdown directories.

Planning, orchestration, CI state, merge state, interventions, task runs, and dispatch state must all be stored in sqlite.

Markdown files are allowed only for:

- import
- export
- human-readable external interchange

### 2. No compatibility workspace bridge

The system must not materialize temporary task markdown just to run the old orchestrator.

That would preserve the wrong execution model:

- file-centric sprint state
- wrong cleanup semantics
- fragile concurrency
- two sources of truth

### 3. Multi-project and multi-sprint support are foundation concerns

This is not a later optimization.

The phase-1 execution model must assume that:

- more than one project can be active
- more than one sprint can be active
- each active sprint can have its own run state
- live views must be derived from DB scope, not one global process-local object

### 4. Executors are pluggable, not separate systems

Sprint OS will support multiple executor types on one orchestration contract:

- local/CLI provider execution with Docker and git worktrees
- Jules remote execution
- connected MCP worker execution

These must share the same task dispatch and run model.

## Current Problems To Eliminate

The old prototype still assumes:

- one global runtime status object
- one active sprint loop
- repo-local subtask markdown as execution input
- merge and rerun behavior writing directly to markdown files
- orchestration identity derived from `repo_path + sprint_number`

Those assumptions block the v2 architecture.

## Phase 1 Outcome

At the end of phase 1, Sprint OS must support:

1. DB-backed management of projects, sprints, and tasks in the v2 dashboard.
2. DB-backed execution state for each active sprint.
3. A transformed `sprint_agent` that executes a selected project/sprint from DB state.
4. Executor selection per task or per sprint run without changing the orchestration model.
5. Docker/worktree and Jules execution still working through the new DB-native dispatch layer.
6. The data model required for connected MCP workers to claim and run tasks later without another schema rewrite.
7. Markdown import/export as an explicit transport path only.

## Required Design Decisions

### 1. Sprint OS directory migration

Runtime/config ownership is:

- repo-scoped: `<repo>/.sprint-os/`
- home-scoped: `~/.sprint-os/`

This replaces:

- `<repo>/.jules-subagents/`
- `~/.jules-subagents/`

This migration is already in progress and remains required.

### 2. Projects and sprints are execution scopes

Execution is no longer scoped by a markdown directory.

Execution scope is:

- `project_id`
- `sprint_id`
- one or more `sprint_runs`

### 3. `sprint_agent` is transformed, not wrapped

For the migration window, the tool name may remain `sprint_agent`, but its behavior must become:

- load sprint context from DB
- derive ready tasks from DB
- dispatch tasks through executor abstractions
- persist run state and events to DB

It must not be a wrapper around the legacy file-based sprint loop.

### 4. Executor abstraction is mandatory

The orchestration core must target an executor interface, not Docker/Jules/worker-specific code paths.

Minimum executor targets:

- `docker_cli`
- `jules`
- `mcp_worker`

### 5. Concurrency is controlled by leases, not globals

Project and sprint execution coordination must use DB-backed ownership or lease records.

The system must not depend on a single process-local “active sprint” concept.

## Proposed Database Foundation

### Management tables

- `projects`
- `project_sources`
- `sprints`
- `tasks`
- `task_dependencies`
- `app_settings`

### Execution tables

- `sprint_runs`
- `task_runs`
- `task_run_events`
- `task_dispatches`
- `execution_leases`

### Multi-MCP / control plane tables

- `mcp_connections`
- `connection_project_bindings`
- `conversation_threads`
- `conversation_messages`

## Recommended Minimum Columns

### `sprint_runs`

- `id`
- `project_id`
- `sprint_id`
- `status`
- `trigger_type`
- `triggered_by`
- `executor_mode`
- `started_at`
- `finished_at`
- `last_heartbeat_at`
- `created_at`
- `updated_at`

`status` should support at least:

- `queued`
- `running`
- `paused`
- `completed`
- `failed`
- `cancelled`

### `task_dispatches`

- `id`
- `project_id`
- `sprint_id`
- `task_id`
- `sprint_run_id`
- `executor_type`
- `connection_id`
- `status`
- `priority`
- `queued_at`
- `claimed_at`
- `started_at`
- `finished_at`
- `last_heartbeat_at`
- `error_message`
- `created_at`
- `updated_at`

`executor_type` should support:

- `docker_cli`
- `jules`
- `mcp_worker`

`status` should support:

- `queued`
- `claimed`
- `running`
- `completed`
- `failed`
- `cancelled`
- `blocked`

### `task_runs`

Treat `task_runs` as execution history, not planning state.

Minimum columns:

- `id`
- `project_id`
- `sprint_id`
- `task_id`
- `sprint_run_id`
- `dispatch_id`
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

### `execution_leases`

- `id`
- `scope_type`
- `scope_id`
- `owner_key`
- `lease_token`
- `acquired_at`
- `expires_at`
- `last_heartbeat_at`

This is the concurrency foundation for:

- active sprint ownership
- worker claims
- future scheduler safety

## Execution Model

### Orchestration input

The orchestrator loads:

- project metadata from `projects`
- sprint metadata from `sprints`
- task graph from `tasks` and `task_dependencies`
- latest execution state from `sprint_runs`, `task_dispatches`, and `task_runs`

### Orchestration output

Each cycle writes:

- sprint-level state to `sprint_runs`
- queued/routed work to `task_dispatches`
- concrete execution history to `task_runs`
- detailed transitions to `task_run_events`

### Task readiness

Ready-task calculation must depend on:

- dependency completion in DB
- active dispatch status
- active run status
- merge/CI gates stored in DB state

### CI and merge logic

CI status and merge gates remain part of orchestration, but they must update DB records directly:

- task merge indicator
- intervention owner/hint
- PR URL
- dispatch/run state

No direct markdown persistence is allowed in execution paths.

## API Shape For Phase 1

### Existing project-management endpoints stay

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
- `GET /api/projects/:projectId/tasks`
- `POST /api/projects/:projectId/tasks`
- `PATCH /api/tasks/:taskId`
- `DELETE /api/tasks/:taskId`

### New execution endpoints

- `GET /api/projects/:projectId/sprints/:sprintId/runs`
- `POST /api/projects/:projectId/sprints/:sprintId/runs`
- `GET /api/sprint-runs/:runId`
- `POST /api/sprint-runs/:runId/pause`
- `POST /api/sprint-runs/:runId/resume`
- `POST /api/sprint-runs/:runId/cancel`
- `GET /api/projects/:projectId/sprints/:sprintId/dispatches`
- `GET /api/projects/:projectId/sprints/:sprintId/task-runs`

## Dashboard Requirements

The v2 dashboard must become the native execution UI.

Required behavior:

- selected project scopes all execution views
- sprint pages show active and historical sprint runs
- task pages show dispatch state, executor type, current owner, PR/branch state, and latest run
- live views resolve from DB execution records, not one global runtime object
- agents/chat pages attach to the same project-scoped execution model

## Phase 1 Backlog

### Track 0: Rebrand and path migration

- Complete `.sprint-os` migration.
- Remove active `.jules-subagents` execution dependencies.

### Track 1: DB-native execution schema

- Add `sprint_runs`
- Add `task_dispatches`
- Add `execution_leases`
- extend `task_runs` and `task_run_events` where needed

### Track 2: Repository-backed execution context

- Implement sprint run repository
- Implement task dispatch repository
- Implement execution lease repository
- Implement repository-backed ready-task and status projection services

### Track 3: Orchestrator refactor

- Refactor `CycleRunner` to read from DB repositories
- Refactor start-ready logic to create dispatch records
- Refactor status derivation to use DB execution state
- Refactor CI/merge gates to write DB state directly
- remove direct markdown execution dependencies

### Track 4: Executor abstraction

- Introduce executor interface
- adapt Docker/worktree CLI flow to DB task payloads
- adapt Jules flow to DB task payloads
- define worker executor contract on the same dispatch model

### Track 5: Dashboard execution surfaces

- add sprint run controls
- add task dispatch visibility
- add DB-backed live execution timelines

## Explicit Non-Goals For This Phase

- final analytics UI
- autonomous multi-project scheduling heuristics
- complete replacement of the MCP tool catalog in one step

## Definition Of Done

Phase 1 is complete when:

- the selected project and sprint in the v2 model can be executed from DB state
- orchestration does not require repo-local task markdown as execution input
- Docker/worktree execution still works through the new DB-native execution model
- the same execution model is capable of later routing tasks to connected MCP workers
- sprint and task runtime views in the dashboard are derived from DB-backed execution records

# Execution Dashboard Projection

This page describes the DB-backed execution snapshot now exposed to the dashboard.

## Purpose

`/api/status` is still useful for task-centric protocol output, but it is not enough to observe the full control plane.

Code UX now projects execution state directly from sqlite into a dedicated dashboard payload so the UI can see:

- sprint runs
- task dispatch queue state
- live MCP connections for the selected project
- worker assignment
- active lease ownership
- recent task-run events

## API Surface

Implemented in `src/server/dashboard-server.ts`.

Endpoints:

- `GET /api/execution`
  - returns the selected project's execution snapshot
- `GET /api/projects/:projectId/execution`
  - returns the execution snapshot for a specific project
- `GET /api/projects/:projectId/stats?window=24h|7d|30d|all|custom&from=YYYY-MM-DD&to=YYYY-MM-DD`
  - returns the project statistics snapshot used by the Stats page
  - `custom` requires both `from` and `to`

## Snapshot Shape

The payload includes:

- `projectId`
- `projectName`
- `query`
- `range`
- `updatedAt`
- `sprintRuns`
- `taskDispatches`
- `connections`
- `recentEvents`

### `sprintRuns`

Each run includes:

- sprint identity
- run status
- trigger type and trigger owner
- executor mode
- heartbeat timestamps
- active sprint lease owner
- rolled-up usage totals for provider time, wall time, and tokens

### `taskDispatches`

Each dispatch includes:

- task and sprint identity
- dispatch status
- executor type
- bound connection metadata
- latest task-run state
- provider/session/pr metadata
- active task-dispatch lease owner
- rolled-up usage totals for provider time, wall time, and tokens

### `recentEvents`

Each event includes:

- task and sprint identity
- task-run and dispatch identity
- event type and originator
- provider/session/branch/PR context
- connection metadata when a worker is involved
- parsed event payload

### `connections`

Each connection summary includes:

- runtime identity and transport
- project scope
- heartbeat-derived status
- listening metadata
- inbox, thread, dispatch, and task-run counters

Current event coverage includes:

- dispatch and worker lifecycle
- provider session sync and provider activity
- direct CLI workflow stage transitions
- CI and merge-gate status changes

## Repository Source

Projection is built in:

- `src/repositories/execution-repository.ts` (public API boundary and snapshot orchestrator)
- `src/repositories/execution/project-execution-snapshot-query.ts` (dashboard snapshot coordination and usage/wall-time mappings)
- `src/repositories/execution/execution-sprint-runs-query.ts` (sprint runs slice query)
- `src/repositories/execution/execution-task-dispatches-query.ts` (dispatches slice query)
- `src/repositories/execution/execution-runtime-events-query.ts` (events slice query)
- `src/repositories/execution/execution-usage-query.ts` (provider usage mapping and rollups)
- `src/repositories/execution/execution-wall-time-query.ts` (wall-time duration projection and DB-driven cache)
- `src/repositories/execution/execution-human-intervention-query.ts` (operator attention formatting)

It joins:

- `sprint_runs`
- `task_dispatches`
- `task_runs`
- `task_run_events`
- `provider_invocations`
- `tasks`
- `sprints`
- `mcp_connections`
- `execution_leases`

This keeps the dashboard read path aligned with the same DB-native runtime records the orchestrator and workers update.

## Current UI Usage

The v2 live page now renders an execution runtime panel showing:

- active sprint runs
- active dispatch counts
- live project connections with inbox and dispatch load
- queued and running worker dispatches
- current lease owners
- a DB-backed runtime timeline
- Sprint Clock telemetry for finished, average-finished, accumulated stage time, and token totals, scoped to the relevant sprint run with dispatch usage preferred and sprint-run usage as fallback

That makes multi-sprint and worker execution visible without reconstructing state from task markdown or process-local globals.

## Backend Read-Model Optimizations

To support the dashboard resource layer and page-scoped module boundaries, the backend read-model optimizations project data efficiently without altering the underlying data structures. **API routes and backend contracts remain unchanged.** This includes optimizing the project execution snapshot path by deduplicating sprint run and task IDs before making secondary aggregation queries for usage and wall-time.

The v2 stats page reads the adjacent project statistics snapshot and renders:

- adaptive hourly, daily, or weekly usage graphs for `24h`, `7d`, `30d`, `all time`, and custom windows
- drag-to-zoom analysis inside the active graph window
- task and sprint usage leaderboards
- provider and execution-purpose splits
- telemetry confidence based on reported versus estimated token counts

## Live Task Timing Reconciliation

The live task timing model now treats the execution snapshot as the source of truth for terminal timing cutoffs when `/api/status` and `/api/execution` are briefly out of sync.

- terminal dispatch fields (`status`, `taskRunState`, `finishedAt`) can stop a task timer even before the task snapshot has promoted its visible status
- terminal runtime events continue to win for late merge settlement and other post-dispatch outcomes
- merge-backed tasks still stay in `CODING_COMPLETED` until real CI or merge-stage evidence appears, so the live page does not mark them fully complete just because coding finished
- when CI wait, CI autofix, automerge, or merge-conflict handling temporarily pushes the persisted task status back to `RUNNING`, the live dashboard still projects those tasks as `CODING_COMPLETED` so race positions and task badges do not regress into the coding lane
- late sync-only events after terminal completion no longer reopen an active timing window

## Realtime Delivery

The execution snapshot is now also pushed to the dashboard over websocket through `/api/realtime`.

Current realtime event used for execution consumers:

- `project.execution.updated`

The browser still loads its initial execution snapshot through REST for execution-focused consumers such as the execution panel and project execution hooks.

For the v2 Live page specifically, execution is no longer applied as an independent visual source of truth. The page now hydrates from `/api/live` and then consumes:

- `project.live.updated`

That combined event folds together:

- selected-sprint `/api/status` data
- project execution snapshot data
- git status
- selected sprint identity from the header-scoped project selection

This keeps the execution read model authoritative for dispatches, runs, connections, and runtime events, while preventing the browser from trying to reconcile separate status and execution payloads into one visual state.

## Subtask State Mapping

To ensure the live projection, project management read-models, and markdown imports all produce a consistent view of a subtask, execution status mapping is centralized in `src/services/subtask-state-mapper.ts`.

This shared module resolves:
- Translation between DB planning statuses (`pending`, `in_progress`, `coding_completed`, `completed`) and orchestrator runtime states (`PENDING`, `RUNNING`, `CODING_COMPLETED`, `COMPLETED`).
- "Latest run" execution state overrides, ensuring that active failures or blocks supersede the persisted planning state.
- Merge-indicator normalization (`CI`, `AUTOMERGE`, `MERGED`, `MERGE_BLOCKED`, `MERGE_CONFLICT`).

By preventing logic drift across repositories and services, the subtask view model remains stable regardless of the data origin.

Related realtime scopes now also exist for the surrounding v2 project-management surfaces:

- `projects`
- `project:<projectId>`
- `thread:<threadId>`

That lets Code UX keep project lists, sprint/task pages, and chat threads in sync without treating execution polling as the only freshness path.

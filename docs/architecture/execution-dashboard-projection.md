# Execution Dashboard Projection

This page describes the DB-backed execution snapshot now exposed to the dashboard.

## Purpose

`/api/status` is still useful for task-centric protocol output, but it is not enough to observe the full control plane.

Sprint OS now projects execution state directly from sqlite into a dedicated dashboard payload so the UI can see:

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

## Snapshot Shape

The payload includes:

- `projectId`
- `projectName`
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

### `taskDispatches`

Each dispatch includes:

- task and sprint identity
- dispatch status
- executor type
- bound connection metadata
- latest task-run state
- provider/session/pr metadata
- active task-dispatch lease owner

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

- `src/repositories/execution-repository.ts`

It joins:

- `sprint_runs`
- `task_dispatches`
- `task_runs`
- `task_run_events`
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

That makes multi-sprint and worker execution visible without reconstructing state from task markdown or process-local globals.

## Realtime Delivery

The execution snapshot is now also pushed to the dashboard over websocket through `/api/realtime`.

Current realtime event used for execution consumers:

- `project.execution.updated`

The browser still loads its initial execution snapshot through REST, then applies websocket updates on top with polling fallback for recovery.

Related realtime scopes now also exist for the surrounding v2 project-management surfaces:

- `projects`
- `project:<projectId>`
- `thread:<threadId>`

That lets Sprint OS keep project lists, sprint/task pages, and chat threads in sync without treating execution polling as the only freshness path.

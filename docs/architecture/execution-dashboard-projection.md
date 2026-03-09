# Execution Dashboard Projection

This page describes the DB-backed execution snapshot now exposed to the dashboard.

## Purpose

`/api/status` is still useful for task-centric protocol output, but it is not enough to observe the full control plane.

Sprint OS now projects execution state directly from sqlite into a dedicated dashboard payload so the UI can see:

- sprint runs
- task dispatch queue state
- worker assignment
- active lease ownership

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

## Repository Source

Projection is built in:

- `src/repositories/execution-repository.ts`

It joins:

- `sprint_runs`
- `task_dispatches`
- `task_runs`
- `tasks`
- `sprints`
- `mcp_connections`
- `execution_leases`

This keeps the dashboard read path aligned with the same DB-native runtime records the orchestrator and workers update.

## Current UI Usage

The v2 live page now renders an execution runtime panel showing:

- active sprint runs
- active dispatch counts
- queued and running worker dispatches
- current lease owners

That makes multi-sprint and worker execution visible without reconstructing state from task markdown or process-local globals.

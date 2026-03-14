# Project Worker Assignment Foundation

## Status
In Progress

## Purpose

`project_worker_assignments` makes worker ownership explicit.

Before this slice, project-to-worker ownership was only inferred from whichever worker happened to poll or claim a dispatch most recently. That was not auditable, and it was not a stable foundation for sticky multi-project supervision.

## Current Implementation

Implemented on March 12, 2026:

- added `project_worker_assignments` to `app.db`
- added `ProjectWorkerAssignmentRepository`
- added `ProjectWorkerAssignmentService`
- worker task claims now record worker activity against the project
- project execution snapshots now expose:
  - `primaryAssignedWorker`
  - `overflowAssignedWorkers`
- worker listen mode now emits `assignment_changed` events with repo context when a worker's project assignment changes

Primary files:

- `src/repositories/project-worker-assignment-repository.ts`
- `src/domain/workers/project-worker-assignment-service.ts`
- `src/services/worker-task-dispatch-service.ts`
- `src/app/lifecycle/dashboard-lifecycle-service.ts`

## Assignment Model

Each assignment records:

- project
- worker endpoint identity
- assignment role
  - `primary`
  - `overflow`
- assignment lifecycle
  - `active`
  - `released`
- assignment timestamps
  - `assignedAt`
  - `lastAffinityAt`
  - `releasedAt`

The row also stores endpoint identity snapshots such as display name and connection key so assignment history remains meaningful even if the backing live worker endpoint changes later.

## Current Assignment Rules

When a worker performs project activity through the worker dispatch path:

- if the worker already has an active assignment on that project, the assignment is refreshed
- if the project has no current primary assignment and the worker does not already own another primary assignment, the worker becomes `primary`
- otherwise the worker becomes `overflow`

This gives the current runtime the right behavior:

- prefer one worker per project when possible
- allow one worker to cover multiple projects when workers are scarce
- keep ownership explicit and queryable

## Dashboard Projection

Project execution snapshots now expose assignment state separately from live connections:

- `connections` still describe live MCP transports
- `primaryAssignedWorker` describes the current sticky owner for the project
- `overflowAssignedWorkers` describe additional workers currently associated with the project

That separation matters because worker ownership and transport state are not the same concept.

## Current Limitation

This is still the foundation, not the full scheduling system.

Still pending:

- explicit reassignment policies
- operator controls to pin/release assignments
- attention queue integration
- non-MCP assignment sources

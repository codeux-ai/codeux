# Execution Schema Foundation

This page describes the first shipped DB-native execution foundation for Sprint OS.

## Scope

This slice does not yet refactor the orchestrator.

It does establish the persistence layer the orchestrator refactor will land on:

- `sprint_runs`
- `task_dispatches`
- `execution_leases`
- `task_runs.sprint_run_id`
- `task_runs.dispatch_id`

## Primary Files

- `src/repositories/app-db-storage.ts`
- `src/contracts/execution-types.ts`
- `src/repositories/execution-repository.ts`

## Why This Matters

The old runtime only had:

- planning entities
- runtime projections in `task_runs`
- no first-class sprint run record
- no first-class dispatch queue
- no lease model for concurrent ownership

The new schema creates the actual execution primitives needed for:

- multiple active sprint runs
- dispatching tasks to different executor types
- later worker claims and scheduling
- DB-backed concurrency control

## Tables

### `sprint_runs`

Represents one execution attempt for one sprint.

Current fields include:

- project and sprint scope
- status
- trigger type
- executor mode
- timestamps and heartbeat

### `task_dispatches`

Represents routed work inside a sprint run.

Current fields include:

- project / sprint / task / sprint run identity
- optional connection binding
- executor type
- dispatch status
- priority
- lifecycle timestamps
- error message

### `execution_leases`

Represents exclusive ownership of an execution scope.

Current fields include:

- scope type
- scope id
- owner key
- lease token
- acquire / expiry / heartbeat timestamps

## Repository Surface

`ExecutionRepository` currently supports:

- create / list / get / update sprint runs
- create / list / update task dispatches
- claim next queued dispatch for an executor type
- acquire / renew / release leases

## Current Boundary

This is persistence only.

The orchestrator, CI gate logic, and watch loop still need to be migrated to read and write these records directly.

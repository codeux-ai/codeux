# Execution Schema Foundation

This page describes the first shipped DB-native execution foundation for Code UX.

## Scope

This page describes the persistence layer that the DB-native orchestrator now uses.

It established:

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

## Follow-Up

The next shipped slice that actually wired these records into the DB-native orchestrator is documented in:

- `docs/architecture/db-native-orchestrator-integration.md`

Remaining work after that slice:

- lease-backed active run ownership
- worker claims from `task_dispatches`
- rerun dispatches
- richer `task_run_events` and activity history

## Indexes

To optimize for the real query shapes used by the DB-native orchestrator and live views, the foundation includes targeted indexes:

- **`idx_conversation_threads_project_updated`**: Sorts threads by project and recent activity (`updated_at DESC`).
- **`idx_conversation_messages_thread_created`**: Speeds up fetching messages within a thread in chronological order (`created_at ASC`).
- **`idx_connection_project_bindings_connection_active`**: Optimizes looking up project binding states for active connections (`is_active DESC, project_id ASC`).
- **`idx_task_dispatches_connection_executor`**: Speeds up worker-affinity and next-task lookups per executor.
- **`idx_project_attention_items_project_status_updated`**: Sorts project-level active attention items by most recently updated (`updated_at DESC`).
- **`idx_project_attention_items_sprint_run_status_updated`**: Speeds up finding attention items blocking specific sprint runs (`updated_at DESC`).

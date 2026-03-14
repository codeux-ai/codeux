# MCP Worker Dispatch Executor

This page describes the first real `mcp_worker` execution path on top of the Sprint OS DB-native runtime.

## Purpose

Connected workers are not a separate runtime.

They now execute through the same core records as the Docker and Jules paths:

- `sprint_runs`
- `task_dispatches`
- `task_runs`
- `task_run_events`
- `execution_leases`

## Task Routing Model

Worker execution is explicit.

Tasks now store `executorType` in sqlite:

- `auto`
- `docker_cli`
- `jules`
- `mcp_worker`

`auto` remains the default so the existing Docker or Jules routing keeps working unless a task is explicitly changed.

## Dispatch Lifecycle

### Queueing

When sprint orchestration starts a ready task whose `executorType = mcp_worker`:

1. Sprint OS creates a `task_dispatch` with `executor_type = mcp_worker`
2. Sprint OS creates a `task_run`
3. the task is marked `in_progress` in project management state
4. no local provider workflow is started

This means the orchestrator stays DB-native and worker-compatible without starting a parallel execution path.

### Claiming

Workers register with `start_listen` using `role = worker`.

They then call `pull_task_dispatch`.

That tool:

1. resolves the worker connection and active project bindings
2. claims the next queued `mcp_worker` dispatch
3. acquires an `execution_lease` on `scope_type = task_dispatch`
4. updates the dispatch to `running`
5. binds the task run to the worker connection
6. returns the full project, sprint, task, and branch payload required to execute work

### Heartbeat and Completion

Workers report progress through `update_task_dispatch`.

Supported states:

- `RUNNING`
- `COMPLETED`
- `FAILED`
- `BLOCKED`

Behavior:

- `RUNNING` renews the task-dispatch lease and updates heartbeat timestamps
- terminal states update both `task_dispatches` and `task_runs`
- terminal states release the task-dispatch lease
- `COMPLETED` marks the DB task as `completed`
- `FAILED` and `BLOCKED` move the DB task back to `pending`

## Worker Payload Shape

`pull_task_dispatch` returns:

- dispatch metadata
- lease token
- project identity and repo/source information
- sprint identity and feature-branch metadata
- task identity, prompt, priority, dependencies, and executor type
- resolved execution context:
  - `repoPath`
  - `defaultBranch`
  - `featureBranch`

That is enough for a connected MCP worker to run the task without reconstructing state from markdown files.

## Why This Is The Right Foundation

This keeps worker execution aligned with the v2 architecture:

- tasks are planned in sqlite
- dispatches are queued in sqlite
- workers claim from sqlite
- run history is auditable in sqlite
- live dashboard state can project from one runtime model

There is no worker-only control plane and no compatibility file bridge.

## External Worker Process

Worker support is now concrete, not schema-only.

The repo now ships `sprint-os-worker`, which:

1. spawns Sprint OS in headless `worker-host` mode
2. connects to that worker-host server over stdio MCP
3. registers as `role = worker`
4. claims DB-native dispatches
5. executes them through the same provider stack already used by Sprint OS
6. heartbeats and finalizes dispatch state through the worker tools

Because transport is stdio today, this is the correct model for a real external worker client without requiring a second network transport.

## Local Worker Execution

Claimed worker dispatches are now started through `execute_worker_dispatch`.

That tool resolves the DB task, sprint, and project and starts the existing task execution path from sqlite-backed runtime data.

This keeps the current Docker/worktree/CI flow intact for worker-owned local execution instead of re-implementing provider workflows inside the worker loop.

## Cancellation Path

Workers now honor dashboard cancel end-to-end.

When `update_task_dispatch` returns `controlAction = "cancel"`:

- the worker calls `cancel_local_dispatch`
- active CLI execution is stopped through the worker-host process' `ActiveDispatchRegistry`
- active Jules execution receives a soft-stop session message

## Dashboard Visibility

Worker dispatches are now visible in the v2 live page through the execution snapshot API.

That means queued, running, blocked, and failed worker dispatches can be inspected in the same dashboard used for sprint orchestration, instead of requiring log inspection or direct database queries.

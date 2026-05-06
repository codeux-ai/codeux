# DB-Native Orchestration Foundation

This page defines the execution architecture Code UX should build toward after the v2 dashboard model was finalized.

## Core Principle

Execution must run on the same domain model the dashboard manages:

- `projects`
- `sprints`
- `tasks`

The system should not keep a separate legacy execution model based on repo-local markdown subtasks.

## Required Runtime Model

### Planning model

- `projects`
- `sprints`
- `tasks`
- `task_dependencies`

### Execution model

- `sprint_runs`
- `task_dispatches`
- `task_runs`
- `task_run_events`
- `execution_leases`

### Control-plane model

- `mcp_connections`
- `connection_project_bindings`
- `conversation_threads`
- `conversation_messages`

## Scope Model

The old prototype treated execution as:

- one repo
- one sprint number
- one file directory

Code UX must treat execution as:

- one project
- one sprint
- one or more sprint runs
- many task dispatches and task runs inside that sprint run

This is the minimum model that supports:

- multiple projects at once
- multiple active sprints at once
- multiple executors
- auditable run history

## Executor Model

The orchestrator should dispatch work through one common executor contract.

Executor types:

- `docker_cli`
- `jules`
- `mcp_worker`

All three must consume the same task payload and write back into the same dispatch/run tables.

That prevents Docker/worktree execution and worker execution from becoming separate systems.

## Why File-Based Compatibility Is Wrong

A compatibility subtask workspace looks convenient, but it preserves the wrong foundation:

- execution state can drift between DB and files
- cleanup semantics target artifacts instead of sprint/task entities
- concurrency becomes unsafe when more than one run touches the same workspace
- merge and CI state remain harder to audit
- worker execution later would force another rewrite

For that reason, materializing markdown for execution should not be part of the long-term runtime design.

## Correct Refactor Direction

### Step 1

Introduce DB-native execution tables and repositories.

### Step 2

Refactor the orchestration loop to:

- load tasks from repositories
- calculate ready tasks from DB dependency and run state
- create dispatches through executor selection
- record results in task runs and events

### Step 3

Move CI, merge, intervention, and rerun logic onto DB state.

### Step 4

Expose sprint runs and dispatches directly in the v2 dashboard.

### Step 5

Attach connected workers to the same dispatch model.

## Tool Direction

`sprint_agent` may remain temporarily as the external MCP tool name, but it must become:

- a DB-native project/sprint execution command
- not a wrapper around the old file-based sprint loop

That preserves tool continuity while allowing the runtime architecture to actually change.

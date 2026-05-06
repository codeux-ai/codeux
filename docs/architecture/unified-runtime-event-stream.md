# Unified Runtime Event Stream

This page documents the execution event model after Code UX stopped treating runtime history as task-only.

## Why This Exists

Task execution events and sprint orchestration events are both runtime truth, but they do not belong to the same scope.

Examples:

- a provider session heartbeat belongs to a `task_run`
- a manual merge pause belongs to a `sprint_run`
- a planning or branch preflight blocker belongs to an orchestration attempt for a sprint, not to one task

Code UX now stores both scopes explicitly and projects them into one dashboard timeline.

## Storage Model

SQLite now persists two durable event streams:

- `task_run_events`
  - provider activity
  - worker lifecycle
  - CLI pipeline stages
  - task-level CI gate updates
  - action-required automation decisions
  - task protocol requirements such as merge-required and intervention-required
- `sprint_run_events`
  - branch or planning preflight blockers
  - watch loop start
  - sprint paused / failed / completed / cancelled outcomes
  - sprint no-more-actions conditions
  - main-merge gate state

Both tables support `source_event_key` deduplication within their own run scope.

## Dashboard Projection

`ExecutionRepository.getProjectExecutionSnapshot(projectId)` now returns `recentEvents` as a unified runtime stream.

Each event row includes:

- `scopeType`
  - `task_run`
  - `sprint_run`
- sprint metadata
- optional task metadata
- optional session / provider / connection metadata
- event payload

This keeps the v2 live dashboard project-scoped while avoiding fake task rows for sprint-level states.

## Current Producers

Task-scoped producers:

- session sync
- connected worker dispatch lifecycle
- CLI workflow stages
- feature PR CI gate
- action-required automation
- protocol generation

Sprint-scoped producers:

- branch preflight blocker
- planning preflight blocker
- watch loop start
- watch loop finish states
- main merge CI/review gate feedback
- dashboard pause and cancel control requests

## Design Rule

New runtime history should follow this rule:

- if the state describes one task execution attempt, write a `task_run_event`
- if the state describes ownership or lifecycle of the sprint orchestration attempt, write a `sprint_run_event`

Do not force sprint state into fake task events just to make it visible in the dashboard.

## Control Plane Events

Dashboard actions now also write into the runtime stream:

- `sprint_pause_requested`
- `sprint_cancel_requested`
- `dispatch_cancelled`
- `dispatch_retry_requested`

That makes operator actions visible in the same project-scoped history as automation and provider activity.

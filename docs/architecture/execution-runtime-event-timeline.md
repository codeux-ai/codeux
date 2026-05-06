# Execution Runtime Event Timeline

This page describes the DB-native event stream that now powers the v2 live runtime feed.

## Purpose

Code UX should not depend on ad hoc session polling responses as the primary dashboard live feed.

The durable runtime timeline now lives in sqlite:

- one `task_run` captures the current execution record for a task run
- many `task_run_events` capture the timeline of what happened during that run
- one `sprint_run` captures the current orchestration record for a sprint execution attempt
- many `sprint_run_events` capture sprint-scoped orchestration state that does not belong to one task

This gives the dashboard, orchestrator, and future worker control paths one shared event history.

## Stored Events

Primary event types now written into `task_run_events`:

- `dispatch_queued`
- `dispatch_started`
- `session_created`
- `dispatch_failed`
- `worker_claimed`
- `run_running`
- `run_completed`
- `run_failed`
- `run_blocked`
- `session_state_synced`
- `provider_activity`
- `cli_prepare_started`
- `cli_prepare_completed`
- `cli_provider_started`
- `cli_provider_completed`
- `cli_provider_usage_reported`
- `cli_git_no_changes`
- `cli_git_pushed`
- `cli_pr_finalized`
- `cli_workflow_completed`
- `cli_workflow_failed`
- `cli_worktree_cleaned`
- `cli_worktree_preserved`
- `ci_gate_status`
- existing `status_sync` projection events from selected-project runtime sync

Primary event types now written into `sprint_run_events`:

- `branch_preflight_blocked`
- `planning_preflight_blocked`
- `watch_loop_started`
- `sprint_merge_required`
- `sprint_no_more_actions`
- `sprint_completed`
- `sprint_failed`
- `sprint_paused`
- `sprint_cancelled`
- `main_merge_gate_status`
- `sprint_pause_requested`
- `sprint_cancel_requested`

Additional task-run control events:

- `dispatch_cancelled`
- `dispatch_retry_requested`

Each event stores:

- `task_run_id`
- `event_type`
- `originator`
- `payload_json`
- `source_event_key`
- `created_at`

## Deduplication

`task_run_events.source_event_key` and `sprint_run_events.source_event_key` are now used to make event ingestion idempotent per run scope.

Current usage:

- provider activities use `activity:<activityId>`
- session state sync uses a signature-based key derived from session identity and state metadata

That allows repeated session polling without duplicating the same dashboard-visible event rows.

## Provider Activity Ingestion

The session sync step still polls provider sessions, but it no longer exists only for transient UI hydration.

It now also:

1. resolves the latest `task_run` for the DB task inside the current `sprint_run`
2. updates `task_runs` session metadata and run state from provider session state
3. updates `task_dispatches` status/heartbeat from that same state
4. writes durable `session_state_synced` and `provider_activity` events

This keeps provider-backed execution on the same runtime contract as worker-backed execution.

`provider_activity` payloads now store normalized activity content, including agent messages, user replies, progress titles/descriptions, plan metadata, and failure/completion markers. That lets:

- the Live page runtime feed render the real Jules message instead of a generic "provider activity" label
- `/api/status` project recent task activities directly from sqlite without calling a separate provider-activity endpoint

## Direct CLI Runtime Events

Docker/CLI-backed execution no longer waits for a later poll to become visible in the runtime timeline.

`CliWorkflowService` now writes stage and outcome events directly against the active `task_run`:

- prepare stage start/complete
- provider stage start/complete
- git finalize outcome
- PR finalize outcome
- workflow success/failure
- worktree cleanup or preservation

It also updates the current `task_run` and `task_dispatch` state immediately on terminal success or failure so the execution snapshot reflects the pipeline outcome before the next session-sync pass.

When a CLI-backed coding invocation completes, the pipeline also writes `cli_provider_usage_reported` with normalized token/time data for that provider call.

The actual per-invocation usage record is stored in `provider_invocations`, which is the canonical source for historical token/time reporting.

## CI Gate Events

`FeaturePrGateService` now writes `ci_gate_status` events into the current sprint run timeline.

These events cover:

- waiting for a feature PR
- waiting on checks or reviews
- blocked after exhausted CI autofix attempts
- ready for merge
- automerge success or failure

This means merge gating is now part of the same DB-native runtime history as dispatch, worker execution, and provider activity.

Virtual worker CI-fix and merge-conflict runs also persist their provider usage into `provider_invocations`, even when they do not emit task-run timeline events.

## Dashboard Projection

`ExecutionRepository.getProjectExecutionSnapshot(projectId)` now returns:

- `sprintRuns`
- `taskDispatches`
- `recentEvents`

`recentEvents` is now a unified runtime stream with `scopeType = "task_run" | "sprint_run"`.

Task events are joined with:

- `task_runs`
- `tasks`
- `sprints`
- `mcp_connections`

Sprint events are joined with:

- `sprint_runs`
- `sprints`

so each row already has the sprint, task when applicable, connection, provider, branch, PR, and payload context the v2 dashboard needs.

## UI Usage

The v2 live page now uses this DB timeline in two places:

- the execution runtime sidebar panel (OverviewTelemetry) shows a project-scoped runtime timeline with compact presentation and differentiated event coloring
- each task card can open a runtime feed derived from recent `task_run_events`

This means the main live feed is now DB-native even when execution is happening through Docker/CLI providers, connected MCP workers, or sprint-scoped orchestration control paths.

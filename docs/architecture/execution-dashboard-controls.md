# Execution Dashboard Controls

This page describes the first DB-native runtime control actions exposed through the v2 dashboard.

## Scope

The dashboard can now control execution state without bypassing the Code UX execution model.

Shipped controls:

- start or resume sprint orchestration for a sprint
- pause an active sprint run
- cancel an active sprint run
- cancel queued, claimed, or running task dispatches
- retry terminal task dispatches through the existing task rerun path

These actions operate on `sprint_runs`, `task_dispatches`, `task_runs`, and runtime events.

## API Surface

The dashboard server now exposes:

- `POST /api/projects/:projectId/sprints/:sprintId/orchestrate`
- `POST /api/sprint-runs/:sprintRunId/pause`
- `POST /api/sprint-runs/:sprintRunId/resume`
- `POST /api/sprint-runs/:sprintRunId/cancel`
- `POST /api/task-dispatches/:dispatchId/cancel`
- `POST /api/task-dispatches/:dispatchId/retry`

## Runtime Behavior

### Start / Resume Sprint

Starting from the dashboard does not invent a second orchestrator path.

It schedules `sprintOrchestrator.execute({ action: "orchestrate", project_id, sprint_id, wait: true })` inside the Code UX server process and lets the normal lease and watch-loop rules apply.

That means:

- duplicate orchestration still respects sprint leases
- a resumed sprint creates a fresh orchestration attempt rather than mutating old run history
- dashboard-triggered execution and MCP-triggered execution converge on the same runtime model
- Code UX now releases stale sprint leases left behind by already-terminal runs, paused runs, and fully-idle cancelled runs before starting a fresh orchestration attempt
- if a lingering sprint lease still exists after stale-run recovery, the dashboard start request now fails fast instead of returning a misleading success while no new run can start
- a sprint cannot be restarted while an older run is still `cancel_requested` with active dispatch shutdown still pending
- if an older `cancel_requested` run is already idle, Code UX finalizes it to `cancelled` before allowing a fresh start, allowing prompt restart without leftover lease blocking
- dashboard-owned watch loops now continue through watch-loop output checkpoints instead of exiting and requiring a manual rerun; the checkpoint return behavior is preserved only for interactive MCP callers

### Pause Sprint Run

Pausing updates the `sprint_run` status to `paused` and writes a `sprint_pause_requested` event.

The watch loop now checks the stored sprint-run status on each iteration and exits when a dashboard pause is observed.

Repeated pause requests are idempotent and return the existing run state without duplicating control events.

### Resume Sprint Run

Resuming a paused run records `sprint_resume_requested` on the paused run and schedules a fresh orchestration attempt for the same sprint through the standard orchestrator entrypoint.

This preserves pause history while re-entering normal sprint lease and watch-loop semantics.

### Cancel Sprint Run

Cancelling now performs immediate teardown for active task containers and marks the sprint terminal in the same control path.

The dashboard:

- force-stops active running dispatches (including Docker-backed task containers) synchronously
- cancels queued, claimed, and paused dispatches immediately
- writes final dispatch/task-run terminal state without waiting for the next scheduler tick
- updates the `sprint_run` to `cancelled`, writes `sprint_cancelled`, and releases the sprint lease

Repeated cancel requests are idempotent for already-cancelled runs and do not recreate events or resurrect dispatch state.

Unexpected orchestration exceptions no longer leave the sprint run stranded in `running`.
If the background orchestrator throws after creating the sprint run, Code UX now marks that run `failed` and writes a `sprint_failed` event with reason `orchestrator_exception`.

This keeps sprint stop behavior auditable and deterministic: once stop returns, no active container-backed dispatch remains on that run.

## Stale Run Recovery

The runtime cleanup sweep now reconciles stale execution records before they block the dashboard:

- if a `task_run` is already terminal but its linked `task_dispatch` is still `queued`, `claimed`, `running`, or `cancel_requested`, the dispatch is reconciled to the same terminal outcome
- if a `running` sprint run has no unexpired sprint lease, no active dispatches, and its heartbeat is stale, Code UX marks it `failed` with reason `orchestration_heartbeat_stalled`
- expired sprint leases attached to those stale runs are released during cleanup so restart does not stay wedged behind dead ownership rows

This prevents dead background orchestration attempts from leaving the dashboard permanently stuck in a fake active state.

## Startup Recovery

Code UX now performs a dedicated execution recovery pass during server startup before the normal cleanup loop begins.

That startup pass is intentionally different from stale-runtime cleanup:

- `queued` and `running` sprint runs are resumed in place (provided their associated sprint in the `sprints` table is still in the `running` status; if the sprint is no longer active, the run is finalized as failed), keeping the original `sprint_run` id instead of creating a fresh restart run
- Code UX releases the orphaned in-process sprint lease from the old server process before reacquiring a fresh lease for the resumed watch loop
- if corrupted state left more than one active `queued` or `running` run for the same sprint, Code UX resumes only the newest run and fails older duplicates as superseded
- interrupted local CLI task dispatches (`docker_cli`) are not treated as still running after process restart; they are rewritten to failed/retryable state so the resumed sprint loop can launch them again safely
- remote/durable executor paths remain attached to the original run:
  - Jules sessions continue through session-sync against the remote provider state
  - connected MCP worker dispatches keep their durable dispatch row and can continue once the worker reconnects with the same connection key

This means a normal app restart no longer requires operators to manually restart an otherwise healthy sprint just to restore the watch loop.

## Dispatch Controls

### Cancel Dispatch

Dispatch cancel now has two paths.

For `queued` and `claimed` dispatches:

When cancelled:

- the dispatch becomes `cancelled`
- the associated `task_run` becomes `BLOCKED`
- a `dispatch_cancelled` runtime event is written
- selected-project dashboard status is updated so the task card reflects the cancellation

For `running` dispatches:

- the dispatch becomes `cancel_requested`
- a `dispatch_cancel_requested` runtime event is written
- the executor is asked to stop cooperatively

Executor-specific behavior:

- `docker_cli`: active local process receives an abort signal and transitions to `cancelled` when shutdown completes
- `mcp_worker`: the next `update_task_dispatch` heartbeat returns `controlAction = "cancel"` so the worker can stop and report back through the same dispatch contract
- `jules`: Code UX sends an in-session close message immediately and then finalizes the dispatch to `cancelled` without waiting for a separate Jules cancel API

### Retry Dispatch

Retry is currently limited to terminal dispatches.

Retry uses the existing task rerun flow instead of inventing a dispatch-only executor path. That keeps retry semantics aligned with normal task restarts.

When a dashboard task rerun has to create a fresh `running` sprint run because no active run exists, Code UX now resumes the watch loop automatically after launching the new task dispatch. That keeps post-task CI, merge-conflict handling, and sprint completion logic moving without requiring a second manual `orchestrate` click after the rerun finishes.

## Remaining Limitation

Code UX now has cooperative stop behavior for local CLI work and connected workers, while Jules uses an immediate close-message path:

- active Docker/CLI executions are aborted through the local process runner, not a kernel-level descendant tree manager
- active Jules sessions still cannot be terminated through an official REST cancel API, so Code UX treats the close message as terminal and reconciles runtime state locally
- worker cancellation depends on the worker honoring the returned `controlAction = "cancel"` contract

That limitation is explicit in the runtime model:

- Code UX records `cancel_requested` separately from final `cancelled`
- live runtime panels show stop-pending state while work is still shutting down
- terminal outcomes are only written once the executor path actually reports back or exits, except for Jules where Code UX finalizes immediately after sending the close message

## Idle Overhead Optimization

The dashboard and background loops now optimize system resources during idle periods to eliminate CPU spikes and avoid unnecessary Docker container query overhead:

- **Idle Reconcile Gating**: The background sprint preview and file browser reconciliation loops (`reconcileSessions()`) now skip the expensive filtered `docker ps` container listings entirely when no active preview or file browser sessions are registered.
- **Docker Query Coalescing & Caching**: Added promise coalescing and a 2-second cache to Docker container queries in `DockerService.listContainers()`, merging concurrent/parallel `docker ps` calls into a single execution.

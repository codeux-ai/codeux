# Execution Dashboard Controls

This page describes the first DB-native runtime control actions exposed through the v2 dashboard.

## Scope

The dashboard can now control execution state without bypassing the Sprint OS execution model.

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
- `POST /api/sprint-runs/:sprintRunId/cancel`
- `POST /api/task-dispatches/:dispatchId/cancel`
- `POST /api/task-dispatches/:dispatchId/retry`

## Runtime Behavior

### Start / Resume Sprint

Starting from the dashboard does not invent a second orchestrator path.

It schedules `sprintOrchestrator.execute({ action: "orchestrate", project_id, sprint_id, wait: true })` inside the Sprint OS server process and lets the normal lease and watch-loop rules apply.

That means:

- duplicate orchestration still respects sprint leases
- a resumed sprint creates a fresh orchestration attempt rather than mutating old run history
- dashboard-triggered execution and MCP-triggered execution converge on the same runtime model
- a sprint cannot be restarted while an older run is still `cancel_requested` with active dispatch shutdown still pending
- if an older `cancel_requested` run is already idle, Sprint OS finalizes it to `cancelled` before allowing a fresh start

### Pause Sprint Run

Pausing updates the `sprint_run` status to `paused` and writes a `sprint_pause_requested` event.

The watch loop now checks the stored sprint-run status on each iteration and exits when a dashboard pause is observed.

### Cancel Sprint Run

Cancelling is now request-based for active work.

The dashboard:

- updates the `sprint_run` to `cancel_requested`
- writes a `sprint_cancel_requested` event
- cancels queued and claimed dispatches immediately
- requests stop for any active running dispatches

The watch loop exits as soon as it observes `cancel_requested`, so Sprint OS stops scheduling new work while active executors wind down.

Once no active dispatches remain, Sprint OS finalizes the run to `cancelled` and writes `sprint_cancelled`.

This means `cancel_requested` is a real stop-pending state, not a terminal state:

- Sprint OS will not start a fresh orchestration attempt while the cancelled run still has active dispatch work
- Sprint OS will finalize an already-idle `cancel_requested` run immediately and allow restart

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
- `jules`: Sprint OS sends an in-session stop message with `send_session_message`, but this remains best-effort because the Jules API still has no hard cancel endpoint

### Retry Dispatch

Retry is currently limited to terminal dispatches.

Retry uses the existing task rerun flow instead of inventing a dispatch-only executor path. That keeps retry semantics aligned with normal task restarts.

## Remaining Limitation

Sprint OS now has cooperative stop behavior for local CLI work and connected workers, but Jules remains soft-stop only:

- active Docker/CLI executions are aborted through the local process runner, not a kernel-level descendant tree manager
- active Jules sessions still cannot be terminated through an official REST cancel API
- worker cancellation depends on the worker honoring the returned `controlAction = "cancel"` contract

That limitation is explicit in the runtime model:

- Sprint OS records `cancel_requested` separately from final `cancelled`
- live runtime panels show stop-pending state while work is still shutting down
- terminal outcomes are only written once the executor path actually reports back or exits

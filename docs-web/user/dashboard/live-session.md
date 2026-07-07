# Live Session

The **Live Session** page (`/live`) is the real-time control room for an active sprint run.

You'll automatically be redirected here when you click **Orchestrate** on a sprint. You can also reach it any time from the dock to view the most recent sprint run for the active project.

## Layout

The page is composed of stacked panels:

1. **Stats header** — High-level metrics: elapsed time, ETA estimate, tasks running, success / failure counts, quota countdown.
2. **Stats deck** — Per-task cards grouped by status. Each card shows:
   - Title, dependency badges, current provider.
   - Live activity preview (the latest line of agent output).
   - Duration and ETA.
   - Optional self-reflection rating badge with the overall 5-star score and a hover/focus details panel for per-section ratings.
   - Buttons to stop, retry, or open the detail panel.
3. **Live Session Runtime Sidebar** — Contains the following collapsible panels:
   - **Invocation feed panel** — A real-time log of individual provider invocations with restart and cancel controls.
   - **Execution timeline** — A horizontal timeline of every event in the run: cycle starts, task transitions, PR opens, merges, attention items.
   - **Git CI status panel** — PR status table for the feature branch: open PRs, CI status, merge conflicts.
   - **Attention ledger** — A dedicated queue for managing human-intervention attention items.
   - **Execution runtime panel** — Core runtime metrics, build statuses, and summary badges.

## Real-time updates

All panels update via the WebSocket connection to `/api/realtime`. Update latency is typically sub-second.

If the WebSocket disconnects (network blip, page sleep), the client automatically reconnects with exponential backoff and replays missed events using the sequence number.

## Idle state

If the project has no active sprint run, the page shows the **Idle Runtime State** panel: a friendly explanation that nothing is running, with a link back to the sprint board.

## Attention items

When the engine cannot proceed without input, an attention item is created. It appears as a row in the **Attention ledger** sidebar panel with:

- Category — `merge_conflict`, `ci_failure`, `action_required`, `qa_review_failed`.
- Linked task and PR.
- Recommended action.
- **Claim** button — Mark that you (or a virtual worker) are working on it.
- **Resolve** button — Mark it resolved; the engine will reattempt the cycle.
- **Dismiss** button — Clear the item from the queue when it is no longer relevant.

A virtual worker can claim an attention item too. If you have configured `virtualWorkerProvider` in settings, the engine will offer eligible items to a worker before showing them to you.

When a sprint is selected in the dashboard top bar, the attention ledger follows that selected sprint scope and shows active `open` and `claimed` items for that sprint, including items tied only to one of its sprint runs. With no selected sprint, the ledger keeps the project-wide active queue.

The Overview telemetry panel uses the same selected-project live snapshot for its compact read-only attention queue, so Overview and Live agree on which sprint's blockers are visible.

## Pause / Cancel from the live view

Two large buttons in the page header:

- **Pause** — emits a control message; the watch loop exits cleanly at the next checkpoint.
- **Cancel** — graceful cancellation; live dispatches are signalled to stop.

A **Force cancel** option is hidden behind a confirm dialog.

### Invocation restart/cancel

Individual provider invocations can be managed directly from the **Invocation feed panel** in the sidebar:
- **Cancel** — Stops a running provider invocation.
- **Restart / Continue** — Restarts a failed planning invocation or continues a disconnected session.
- **Reset timer** — Resets the rate-limit timeout for a quota-blocked invocation.

## Finalisation

When all tasks settle, the watch loop runs the *finalisation step*:

- Resolves remaining attention items.
- Optionally runs a QA review pass.
- Checks main-branch merge status.
- Either merges the feature branch into `main` (if `mainBranchAutoMergeMode` allows) or shows you the exact `gh pr merge` / `git merge` command to run.
- Cleans up Docker worktrees from terminal CLI dispatches.
- Triggers memory auto-promotion (short-term → long-term).
- Transitions the sprint to `completed`, `failed`, `paused`, or `cancelled`.

Once finalised, the page presents a one-line summary, a link to the run's stats page, and a **Run again** button.

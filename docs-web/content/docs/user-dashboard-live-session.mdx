# Live Session

The **Live Session** page (`/live`) is the real-time control room for an active sprint run.

You'll automatically be redirected here when you click **Orchestrate** on a sprint. You can also reach it any time from the dock to view the most recent sprint run for the active project.

Sprint links can open Live directly with `/live?projectId=<projectId>&sprintId=<sprintId>`. Live consumes a new route project once before selecting the route sprint, while later shared project selection and top-nav scope changes remain authoritative. This keeps selectors and runtime filters aligned without letting an older mounted Live tab repeatedly force its retained deep-link project back into view.

Overlapping selection requests are fenced by request order and project ownership. A late response for the project or sprint you just left cannot switch Live back or place that sprint in the newly selected project's runtime scope.

## Layout

The page is composed of stacked panels:

1. **Stats header** — High-level metrics: elapsed time, ETA estimate, tasks running, success / failure counts, quota countdown.
2. **Stats deck** — Per-task cards grouped by status. Each card shows:
   - Title, dependency badges, current provider.
   - Live activity preview (the latest line of agent output).
   - Duration and ETA.
   - Optional self-reflection rating badge once a worker has captured one, with the overall 5-star score and a hover/focus details panel for per-section ratings and notes.
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

## Self-reflection ratings

Live task cards can show a compact 5-star self-reflection badge when the task snapshot includes `selfReflectionRating`. The badge uses the task's overall rating for the visible score, and hover or keyboard focus opens a viewport-positioned panel with the individual section ratings and any notes the worker recorded. Live tasks without a captured rating do not show a placeholder badge.

## QA review states and follow-up specifications

Live task cards use the same QA review badge as Tasks and Sprints. The badge represents the latest persisted review summary independently of the current runtime phase, so a requested-change verdict remains inspectable while the follow-up work runs and after Live reconnects.

| Presentation | Meaning |
| --- | --- |
| Green check, **QA passed** | The QA run completed with a passing verdict. |
| Signal-colored spinner, **QA review running** | A QA provider is actively reviewing the work. Reduced motion replaces the spin and pulse with a static ring and label. |
| Blue pencil, **QA edits** / **QA changes requested** | QA completed successfully and requested changes. This is an actionable review outcome, not a provider failure. |
| Red X, **QA failed** | The QA provider run failed, errored, or was cancelled before returning a usable verdict. It does not mean QA requested code changes. |

Hovering the badge, focusing it with the keyboard, or activating it opens an accessible, viewport-positioned review card. The card is named by its review heading and can include the outcome, summary, findings, fix instructions, target task key, reviewer, reviewed time, and generated follow-up tasks. Focus may move between the badge, card, and disclosure buttons without closing it. `Escape` closes the card and restores focus to the badge; moving the pointer away closes it after a short grace period when focus is not inside, and a mouse or touch press outside dismisses it. On touch devices, tap the badge to open it and tap outside to dismiss it.

Generated follow-up task specifications are collapsed initially, so long prompts do not dominate the review. Each **Follow-up task N** button exposes `aria-expanded` and can be toggled with the keyboard or touch. Expansion reveals the generated title, description, priority, dependency task keys (or **None**), and full Markdown prompt in a bounded scrolling area. The card uses one column on constrained screens, may split summary and findings on wider screens, clamps to the viewport, and scrolls vertically when needed. Reduced motion removes spinner, pulse, rotation, and transition movement without removing labels, borders, focus rings, expanded content, or state semantics.

## Pull request, checks, and merge workflow

The CI badge summarizes a three-step workflow shared by Sprints, Tasks, and Live:

1. **Pull request** — waiting for a PR, missing a required PR, or PR ready.
2. **Checks** — pending, running, passed, or failed checks.
3. **Merge** — waiting for checks, QA, or review; checking mergeability; ready to merge; merging; merged; not required; conflict; or failed merge attempt.

Pending uses a neutral clock, running uses the signal-colored progress treatment, success uses a green check, and failure uses a red X. Failure wins over running, running wins over pending, and pending wins over success when the overall badge is derived from the three steps.

The red X is reserved for an actual failed workflow step: failed CI checks, a merge conflict, or a failed merge attempt. A review blocker is not a CI failure: checks remain passed and Merge reads **Waiting for review** in a pending state. A merge conflict fails the Merge step and is labelled **Merge conflict**, which keeps it distinct from **CI failed** at Checks. QA provider failure is shown by the separate QA badge and does not become a CI failure. Activate the CI badge to inspect all three step labels and states; `Escape` closes the details and returns focus to the badge.

These badges do not poll per card. Task feature-PR gates are persisted as `ci_gate_status` task-run events, and Live narrows them to the selected sprint and the latest dispatch's sprint run before choosing the newest matching event by creation time and then event ID. Unresolved CI repair attention is combined while its item is `open` or `claimed`; persisted task merge metadata is used only as durable fallback evidence when no matching event is available.

Because the evidence is persisted and rehydrated into the initial Live snapshot, server restarts and browser reconnects reconstruct the same state before realtime updates continue; cards do not need independent recovery timers. A newer settled event supersedes an older failed or waiting event, resolved or dismissed attention no longer forces failure, and clearing or settling the durable task merge indicator prevents historical CI events from resurrecting a stale badge.

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

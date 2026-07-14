# Tasks

The **Tasks** page (`/tasks`) is a Kanban-style task board for the active project. It organizes tasks into **Queued**, **In Progress**, and **Completed** lanes, with sprint scope, status, priority, and search controls above the board.

Use it when you want to review planned work, create or edit a task, check dependency blockers, or choose how a specific task should be executed.

## Language and task content

The Tasks page follows the dashboard language setting and is fully available in English and German. This includes board headings, filters, lanes, task actions, dependency and review labels, editor validation, confirmations, loading and empty states, and screen-reader announcements. Counts (including thousands separators), dates, elapsed durations, and rating values use the conventions of the selected language.

Localization never rewrites task data or worker output. Task keys, titles, descriptions, Markdown prompts, project and sprint names, branch and pull-request details, provider and agent names, QA and review text, execution messages, and backend error details remain exactly as stored or received. Switching the dashboard language therefore changes only the surrounding interface, not the content sent to a worker or persisted through create, edit, rerun, dependency, and delete operations.

Sprint schedules on this page are formatted in the selected language directly from their start and end dates. Sprints without valid dates show a localized open-schedule fallback. The task-time labels produced by the dashboard for completed, review, active, not-started, and optimistic states are also localized, while provider and API runtime values remain verbatim.

## Project and sprint scope

The global project selector in the navbar owns the active project. Changing projects while you are on `/tasks` updates the router to the new project and resets any stale sprint filter that belonged to the previous project. A project-aware deep link is consumed once when it opens; it is not continuously enforced afterward. An older mounted Tasks tab therefore follows later project changes instead of switching the selector back, including when another dashboard tab changes the active project.

The sprint selector inside the Tasks page only scopes the board for the current project. Choosing a sprint updates router search state and stores that sprint selection for the active project. Sprint links from the Sprints page use `/tasks?projectId=<projectId>&sprintId=<sprintId>`; the Tasks page switches to the route project first, then stores and loads the route sprint after that project is active. Legacy same-project links such as `/tasks?sprint=<id>` and `/tasks?sprintId=<id>` remain supported.

If project or sprint selection requests overlap, only the newest response may update the active scope. Responses for a project you have already left remain confined to that project's cached sprint collection and cannot change the current board.

## Board workflow

The board keeps the current sprint scope and filters visible while you work:

- **Sprint scope** narrows the board to all tasks or one sprint.
- **Status and priority filters** refine the visible cards without losing the current board context.
- **Search** matches task titles and task text.
- **Visible count controls** limit how many cards render in each lane for larger projects.

## Columns

Task cards show the task title, status, priority, dependency state, downstream dependents, executor metadata, recent activity context, optional self-reflection ratings, and available actions. Dragging a card to another lane changes its status when that transition is available.

When a worker reports a task-run self-reflection rating, the shared rating badge appears in the compact card metadata near the task id, status, and priority. It shows the overall `overallRating` as a numeric score with a compact 5-star meter. Hovering the badge, or focusing it with the keyboard, opens a viewport-positioned details panel with each section from `sections`: the section label, matching stars, numeric rating, and any note captured by the worker. Tasks without a captured rating, including older tasks that never produced one, do not render an empty badge slot.

## QA review states and follow-up specifications

Task cards use the same QA review badge as Sprints and Live. The badge represents the latest persisted review summary independently of the task lane or phase, so requested-change details remain available while a follow-up run is active and after a reconnect.

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

The four first-class workflow states are `pending`, `in_progress`, `successful`, and `failed`. Pending uses a neutral clock, `in_progress` is presented as running with the signal-colored progress treatment, `successful` uses a green check, and `failed` uses a red X. Failed wins over in progress, in progress wins over pending, and pending wins over successful when the overall badge is derived from the three steps.

The red X is reserved for an actual failed workflow step: failed CI checks, a merge conflict, or a failed merge attempt. A review blocker is not a CI failure: checks remain passed and Merge reads **Waiting for review** in a pending state. A merge conflict fails the Merge step and is labelled **Merge conflict**, which keeps it distinct from **CI failed** at Checks. QA provider failure is shown by the separate QA badge and does not become a CI failure. Activate the CI badge to inspect all three step labels and states; `Escape` closes the details and returns focus to the badge.

These badges do not poll per card. Task feature-PR gates are persisted as `ci_gate_status` task-run events, and unresolved CI repair attention remains active while its item is `open` or `claimed`. The card projection selects the newest matching task event by creation time and then event ID, combines it with active attention, and uses persisted task merge metadata only as durable fallback evidence when no matching event is available.

Because the evidence is persisted and rehydrated into project and Live snapshots, server restarts and browser reconnects reconstruct the same state before realtime updates continue; cards do not need independent recovery timers. A newer recognized settled gate event supersedes an older failed or waiting event for the same task, and resolved or dismissed attention no longer forces failure.

## Create and edit tasks

Use **New Task** or a card's **Edit** action to open the task editor. The editor opens inside the Tasks workspace instead of replacing the board:

- On wide screens, the editor appears as a full-height right-side viewbox beside the board.
- On narrow screens, the editor becomes the primary full-width panel above the board.
- Cancel returns to the board without changing the draft.
- Save keeps the selected sprint scope and active filters in place.

The editor includes:

| Field | Description |
| --- | --- |
| **Title** | Required task name shown on the card. |
| **Description** | Short user-facing summary for scanning the board. |
| **Markdown prompt** | Detailed implementation instructions for the worker. |
| **Status** | Current board state for the task. |
| **Priority** | Planning priority used for board sorting and visual emphasis. |
| **Dependencies** | Other tasks that must be completed first. Dependency choices remain selected even when filtering hides them. |
| **Executor mode** | Task execution preference: automatic, CLI-backed worker, or Jules-backed worker where available. |
| **Worker agent** | Optional task-level worker-agent override. The built-in worker leaves `agentPresetId` empty; choosing a configured agent preset saves that preset id on the task. |

Validation keeps the current draft visible. If a required field is missing, the editor focuses the first invalid field and shows the error inline.

## Dependencies

Dependencies determine whether a task is ready to run. A task with incomplete dependencies remains blocked until those dependencies move to a completed state. Cards show dependency blockers and downstream dependent tasks so you can see both what a task waits on and what it unblocks.

The editor prevents invalid dependency selections such as dependency cycles. When a dependency cannot be selected, the reason is shown in the editor rather than silently hiding the option.

## Task actions

Task cards expose actions for the work that is available in the current state:

- **Edit** opens the full task editor for content, dependencies, executor mode, and worker-agent selection.
- **Rerun** starts a fresh execution attempt for the task when rerun is available.
- **Preview** opens the task's available runtime preview when one exists.
- **Live** opens live task context when runtime details are available.
- **Delete** removes the task after confirmation.

Unavailable actions stay visible with a reason so the board layout remains stable and keyboard users can understand why an action cannot run.

## Status legend

| Lane | States | Meaning |
| --- | --- | --- |
| **Queued** | `pending`, blocked variants | Not ready or not started yet. |
| **In Progress** | `in_progress`, `coding_completed`, `QA_REVIEW_FAILED` | Active work, review, or follow-up is still underway. |
| **Completed** | `completed` | The task is finished. |

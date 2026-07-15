# Tasks

The **Tasks** page (`/tasks`) is a Kanban-style task board for the active project. It organizes tasks into **Queued**, **In Progress**, and **Completed** lanes, with sprint scope, status, priority, and visible-card controls above the board.

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

The page header keeps project and sprint context beside the primary **New Task** command. Immediately below it, the board uses two compact operational surfaces:

- **Task board controls** keeps sprint scope, status, priority, and visible-card count together. It stacks on phones, wraps into two columns on tablets, and becomes one rail on wide screens. Long sprint names stay inside the selector instead of widening the page.
- **Task board overview** shows the filtered total plus running, completed, and critical counts. When a sprint is selected, it also shows the sprint date, percentage complete, an accessible completed-task progress bar, and the queued/running/completed distribution.

The controls keep the current sprint scope and filters visible while you work:

- **Sprint scope** narrows the board to all tasks or one sprint.
- **Status and priority filters** refine the visible cards without losing the current board context.
- **Visible count controls** limit how many cards render in each lane for larger projects.

## Columns

Each lane is a named region whose accessible name includes its count, such as **In Progress lane, 2 tasks**. The board uses one column on phones, two columns when lanes remain readable, and three columns on wide screens. Lane frames and drop surfaces keep a stable height while filters settle, data loads, or a lane is empty, so adjacent work does not collapse or jump. Loading lanes use card-shaped skeletons; empty lanes explain whether the result comes from filters, the selected sprint, or project-wide scope; refresh failures appear as an assertive board update message without removing the current board context.

Reduced-motion mode removes board, card, selector, progress, menu, and drop-target movement and disables pointer dragging. Static labels, borders, focus rings, progress values, lane counts, empty states, action availability reasons, and drag-disabled guidance remain available.

Each task card shows its task identifier, title, status, and priority first. Compact metadata can then show a non-default executor or worker agent, session state and identifier, the unified delivery workflow, dependency blocker count, optimistic saving state, source and assignee, runtime duration, pull-request state, creation or live-start time, and an optional self-reflection rating. The footer always keeps the task-labelled **Actions** trigger visible. Dragging a card to another lane changes its status when that transition is available.

When a worker reports a task-run self-reflection rating, the shared rating badge appears in the compact card metadata near the task id, status, and priority. It shows the overall `overallRating` as a numeric score with a compact 5-star meter. Hovering the badge, or focusing it with the keyboard, opens a viewport-positioned details panel with each section from `sections`: the section label, matching stars, numeric rating, and any note captured by the worker. Tasks without a captured rating, including older tasks that never produced one, do not render an empty badge slot.

## Delivery workflow and QA review details

Task cards use the shared bright delivery workflow badge in place of the standalone QA and CI badges. The task lifecycle label remains visible beside it, while the badge itself always exposes Coding → Pull request → QA → CI → Merge → Completion. Lifecycle and review state keep the badge durable when CI evidence is absent or refreshing. An open or claimed task-matched human/user intervention with no worker assignment takes precedence as a red **Human needed** trigger; clearing or handing the item to automation restores the ordinary workflow stage.

| Presentation | Meaning |
| --- | --- |
| Green check, **QA passed** | The QA run completed with a passing verdict. |
| Signal-colored spinner, **QA review running** | A QA provider is actively reviewing the work. Reduced motion replaces the spin and pulse with a static ring and label. |
| Blue pencil, **QA edits** / **QA changes requested** | QA completed successfully and requested changes. This is an actionable review outcome, not a provider failure. |
| Red X, **QA failed** | The QA provider run failed, errored, or was cancelled before returning a usable verdict. It does not mean QA requested code changes. |

Hovering, focusing, or activating the badge opens one viewport-positioned interaction region on a lightly translucent, blurred outer surface. Its opaque Delivery flow card contains six vertically centered circles connected by motion-safe animated dots. When review data exists, a floating responsive arrow points to the opaque QA review card with the outcome, summary, findings, fix instructions, target task key, reviewer, reviewed time, and generated follow-up tasks. `Escape` closes the region and restores focus to the exact workflow or QA trigger that opened it; outside pointer or touch input dismisses it.

Generated follow-up task specifications are collapsed initially, so long prompts do not dominate the review. Each **Follow-up task N** button exposes `aria-expanded` and can be toggled with the keyboard or touch. Expansion reveals the generated title, description, priority, dependency task keys (or **None**), and full Markdown prompt in a bounded scrolling area. The card uses one column on constrained screens, may split summary and findings on wider screens, clamps to the viewport, and scrolls vertically when needed. Reduced motion removes spinner, pulse, rotation, and transition movement without removing labels, borders, focus rings, expanded content, or state semantics.

## Six-stage delivery flow

The workflow badge summarizes six stages shared by Sprints, Tasks, Overview, and Live:

1. **Coding** — waiting, queued, preparing, active, quota/capacity wait, paused, complete, or failed.
2. **Pull request** — waiting for a PR, missing a required PR, creating, or ready.
3. **QA** — pending, reviewing, passed, blue **QA edits**, or provider/runtime failure.
4. **CI** — checks pending, running, passed, or failed.
5. **Merge** — waiting, checking mergeability, ready, merging, merged, not required, conflict, or failed attempt.
6. **Completion** — waiting, complete, failed, or cancelled.

The four first-class workflow states are `pending`, `in_progress`, `successful`, and `failed`. Pending uses a neutral clock, `in_progress` is presented as running with the signal-colored progress treatment, `successful` uses a green check, and `failed` uses a red X. Failed wins over in progress, in progress wins over pending, and pending wins over successful when the overall badge is derived from the three steps.

The red X identifies an actual provider/runtime or workflow failure, or explicit active **Human needed** intervention. Requested QA edits use the bright blue pencil treatment, not failure red. A review blocker is not a CI failure: CI remains passed and Merge reads **Waiting for review**. A merge conflict belongs to Merge and remains distinct from **CI failed**.

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

Dependencies determine whether a task is ready to run. A task with any dependency that is not completed remains blocked, including one whose dependency is **Ready for QA**. Cards use an amber blocker summary when work is blocked and a green clear summary when every dependency is completed. Each compact dependency row visibly contains only its task identifier and one normalized status: **Resolved**, **Ready for QA**, **In progress**, **QA failed**, **Blocked**, or **Unknown**. The complete dependency title, raw status, and blocking or resolved meaning remain available to assistive technology and in the row tooltip.

The editor prevents invalid dependency selections such as dependency cycles. When a dependency cannot be selected, the reason is shown in the editor rather than silently hiding the option.

## Task actions

Every task card keeps a visible, task-labelled **Actions** trigger in its footer. Activating it opens three groups:

- **Execution & navigation** contains **Rerun**, **Preview**, the eligible **PR** or **PR pending** entry, and **Live** or **Live idle**. Rerun is an informational disabled item that directs you to Live; it does not dispatch a run from the Tasks page. Preview opens the sprint preview when the task belongs to a sprint. PR opens an existing pull request in a new tab, while PR pending explains that no pull request is available yet. Live opens the runtime page only after runtime context exists.
- **Task management** contains **Edit**, which opens the full inline task editor for content, dependencies, executor mode, and worker-agent selection.
- **Danger zone** contains **Delete**.

The menu opens with click, Enter, Space, Arrow Up, or Arrow Down. Opening focuses the first enabled action; Arrow Up opens at the last enabled action. Arrow keys wrap between enabled actions, Home and End jump to the first and last enabled actions, and Enter or Space activates the focused action. Escape or clicking outside closes the menu and restores focus to the trigger.

Unavailable actions included by the current task and project settings stay visible but inert, with the reason directly beneath the action label. For example, Preview explains when a task has no sprint, Live explains when runtime has not started, and every action explains when an optimistic save temporarily makes it unavailable. The trigger remains available while a card is saving so these reasons are still discoverable, while duplicate mutations remain suppressed. When project settings disable task pull requests and the task has no existing PR, the menu omits the PR entry instead of showing a misleading pending action.

Edit does not ask for confirmation: it opens the editor with the current task values, and Cancel closes the editor without saving. Save keeps the selected sprint scope and active filters in place. Delete closes the menu and opens a **Delete Task** confirmation that names the task, states that removal cannot be undone, and requires holding the destructive button until confirmation completes. Cancelling or pressing Escape leaves the task in place and returns focus to that card's **Actions** trigger.

## Responsive and keyboard behavior

On wide screens, the three lanes share one row when space permits. On phones, they stack vertically and card titles, dependency identifiers, and action menus remain within the page width without creating document-level horizontal scrolling. Menus are positioned inside the current viewport even when their card is near an edge.

The board keeps accessible lane counts and status announcements during loading, filtering, optimistic saves, realtime refreshes, and empty or error states. Opening a task menu with the keyboard moves focus to its first enabled action; `Escape` returns focus to the same task-labelled trigger. Cancelling deletion also returns focus to that trigger, and reduced-motion mode preserves the same status text and focus treatment while disabling drag movement.

## Status legend

| Lane | States | Meaning |
| --- | --- | --- |
| **Queued** | `pending`, blocked variants | Not ready or not started yet. |
| **In Progress** | `in_progress`, `coding_completed`, `QA_REVIEW_FAILED` | Active work, review, or follow-up is still underway. |
| **Completed** | `completed` | The task is finished. |

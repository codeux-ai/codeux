# Tasks

The **Tasks** page (`/tasks`) is a Kanban-style task board for the active project. It organizes tasks into **Queued**, **In Progress**, and **Completed** lanes, with sprint scope, status, priority, and search controls above the board.

Use it when you want to review planned work, create or edit a task, check dependency blockers, or choose how a specific task should be executed.

## Project and sprint scope

The global project selector in the navbar owns the active project. Changing projects while you are on `/tasks` updates the router to the new project and resets any stale sprint filter that belonged to the previous project. A project-aware deep link is consumed once when it opens; it is not continuously enforced afterward. An older mounted Tasks tab therefore follows later project changes instead of switching the selector back, including when another dashboard tab changes the active project.

The sprint selector inside the Tasks page only scopes the board for the current project. Choosing a sprint updates router search state and stores that sprint selection for the active project. Sprint links from the Sprints page use `/tasks?projectId=<projectId>&sprintId=<sprintId>`; the Tasks page switches to the route project first, then stores and loads the route sprint after that project is active. Legacy same-project links such as `/tasks?sprint=<id>` and `/tasks?sprintId=<id>` remain supported.

## Board workflow

The board keeps the current sprint scope and filters visible while you work:

- **Sprint scope** narrows the board to all tasks or one sprint.
- **Status and priority filters** refine the visible cards without losing the current board context.
- **Search** matches task titles and task text.
- **Visible count controls** limit how many cards render in each lane for larger projects.

## Columns

Task cards show the task title, status, priority, dependency state, downstream dependents, executor metadata, recent activity context, optional self-reflection ratings, and available actions. Dragging a card to another lane changes its status when that transition is available.

When a worker reports a task-run self-reflection rating, the shared rating badge appears in the compact card metadata near the task id, status, and priority. It shows the overall `overallRating` as a numeric score with a compact 5-star meter. Hovering the badge, or focusing it with the keyboard, opens a viewport-positioned details panel with each section from `sections`: the section label, matching stars, numeric rating, and any note captured by the worker. Tasks without a captured rating, including older tasks that never produced one, do not render an empty badge slot.

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

# Tasks

The **Tasks** page (`/tasks`) is a Kanban-style task board for the active project. It organizes tasks into **Queued**, **In Progress**, and **Completed** lanes, with sprint scope, status, priority, and search controls above the board.

Use it when you want to review planned work, create or edit a task, check dependency blockers, or choose how a specific task should be executed.

## Board workflow

The board keeps the current sprint scope and filters visible while you work:

- **Sprint scope** narrows the board to all tasks or one sprint.
- **Status and priority filters** refine the visible cards without losing the current board context.
- **Search** matches task titles and task text.
- **Visible count controls** limit how many cards render in each lane for larger projects.

Task cards show the task title, status, priority, dependency state, downstream dependents, executor metadata, recent activity context, and available actions. Dragging a card to another lane changes its status when that transition is available.

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

# Tasks

The **Tasks** page (`/tasks`) is a flat, filterable view of every task in the active project, across all sprints.

Use it when you want to find a task by name, see what is running right now, or batch-act on a set of tasks.

## Columns

| Column | Description |
| --- | --- |
| **Status** | One of `PENDING`, `RUNNING`, `CODING_COMPLETED`, `COMPLETED`, `FAILED`, `BLOCKED`, `QUOTA`, `QA_REVIEW_FAILED`. |
| **Title** | Task title from the markdown frontmatter. |
| **Sprint** | The owning sprint. Click to jump to it. |
| **Provider** | Which provider executed this task (`jules`, `gemini`, `codex`, `claude-code`, `qwen-code`, `opencode`). |
| **Branch / PR** | Worker branch and PR link if one has been opened. |
| **Merge state** | `MERGED`, `AUTOMERGE`, `CI`, `MERGE_BLOCKED`, `MERGE_CONFLICT`, `PR_ONLY`, `QA_PENDING`. |
| **Duration** | Time from start to current state. |
| **Updated** | Last activity timestamp. |

## Filters

A filter bar above the table supports:

- **Status** (multi-select)
- **Sprint** (multi-select)
- **Provider** (multi-select)
- **Search** — substring match on title.
- **Has attention item** — only show tasks that need human / agent attention.

Filters compose; the count of matching tasks is shown next to the table title.

## Task actions

Each row has a **⋯** menu with:

- **Open** — go to the live task card.
- **Rerun** — start a fresh dispatch. Options: choose `provider`, `clearWorktree` (delete the existing worktree first), `resetDependents` (cascade reset to dependent tasks).
- **Stop** / **Force stop** — halt the active dispatch.
- **Pause** — pause the active dispatch.
- **Edit** — open the task editor (title, prompt, dependencies, priority).
- **Delete** — destructive; requires confirmation.

These also map directly to MCP `manage_code_ux` actions on the `tasks` domain (`start`, `stop`, `force_stop`, `pause`, `update`, `delete`).

## Task details panel

Clicking a row opens a detail panel showing:

- The full prompt.
- The current session log (live).
- Linked PR with CI checks.
- Activity stream (every step the agent has taken).
- Worker branch tree status.

Anything you can do from this panel (rerun, stop, edit) is also available via the MCP API — see [Management actions → tasks](../../developer/management-actions.md#tasks).

## Status legend

| Icon | State | Meaning |
| --- | --- | --- |
| ⏳ | `RUNNING` | Worker is actively coding. |
| 🤝 | `CODING_COMPLETED` | Code complete, PR open, awaiting CI / merge. |
| ✅ | `COMPLETED` | Merged into the feature branch. |
| ❌ | `FAILED` | Worker errored. Will be retried if `retryFailed: true`. |
| 🚫 | `BLOCKED` | Waiting for dependencies to merge. |
| 💤 | `PENDING` | Not yet started this cycle. |
| ⚠ | `QUOTA` | Provider quota exhausted; will retry next cycle. |
| 🛑 | `QA_REVIEW_FAILED` | A QA agent rejected the output. |

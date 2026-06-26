# File Browser

The **File Browser** page (dock label **Files**, `/files`) lets you inspect a project's files and
review a sprint's Git changes from inside the dashboard, without switching to a terminal or editor.

## Sessions

The File Browser works through a **session** bound to a sprint, so you can browse the exact state a
sprint is producing. A session has a status:

| Status | Meaning |
| --- | --- |
| **Running** | The session is live and serving files and diffs. |
| **Starting** | The session is spinning up. |
| **Stopped** | The session is not currently running. |
| **Error** | The session failed to start or crashed. |

You can **start**, **stop**, **rebuild**, and **remove** sessions, and pick which sprint to launch a
session for.

## Files mode

In **Files** mode you get a file tree for the project plus a viewer:

- Navigate the tree and open any file to view its contents with syntax highlighting.
- Search to jump to a path quickly.

## Changes mode

In **Changes** mode you review what a sprint has modified:

- A **changes list** of added, modified, and deleted files for the selected sprint's branch.
- A **diff viewer** showing the changes per file, with a side-by-side or stacked layout.

This makes it easy to review a sprint's work — or an individual task's output — before merging,
complementing the PR/CI review handled by the [merge protocol](../automation-and-ci.md).

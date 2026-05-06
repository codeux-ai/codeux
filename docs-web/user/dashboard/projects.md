# Projects

The **Projects** page (`/projects`) lists every project Code UX manages and lets you create, edit, select, and delete them.

A *project* is the binding between Code UX and a single Git repository. Each project has its own:

- Sprints, tasks, runs, dispatches.
- Agent presets and memories.
- Settings overrides on top of system defaults.
- Worker assignments controlling which connected MCP clients can pick up its work.

## Creating a project

Click **+ New project**. The form collects:

| Field | Required | Description |
| --- | --- | --- |
| Name | Yes | Human-readable label. |
| Repository path | Yes | Absolute path to a Git checkout on the host filesystem. |
| Default branch | No (default `main`) | The branch sprints merge into. |
| Feature branch prefix | No (default `feature/codeux/`) | Used to derive sprint feature branch names. |
| GitHub mode | No (default `REMOTE`) | `REMOTE` uses the GitHub API via `gh`; `LOCAL` operates only on local Git state. |
| Description | No | Free-form. |

On save, Code UX:

1. Verifies the path exists and is a Git working tree.
2. Initialises `<repo>/.code-ux/` with project-local subdirectories (settings, sprints, agents, memory).
3. Reads any external settings hints (Jules / Gemini / Codex / Claude / Qwen / OpenCode CLI auth) and pre-populates provider settings.

## Selecting the active project

Most other dashboard pages operate on a *single active project*. The active project is selectable from:

- The top bar dropdown (always visible).
- A click on any project card on the Projects page.

Programmatically, the active project ID is sent with REST calls (`/api/projects/:projectId/...`) and is the implicit scope of the WebSocket subscription.

## Editing a project

Click the **⋯** menu on a project card and choose **Edit**. The fields above are editable except the repository path; to change the path, delete and re-create the project.

## Deleting a project

Deletion is destructive — it removes the project's database row and runtime state, but **does not** delete files inside `<repo>/.code-ux/`. The MCP `manage_code_ux` action requires explicit `approval.confirmed = true`.

In the dashboard, the **Delete** action shows a confirm dialog with the count of sprints, tasks and memories that will become orphaned.

## Worker assignment

The card footer shows the *preferred worker* for the project — the connection that virtual-worker dispatches favour when multiple workers are eligible. You can change it via the **Set worker** dropdown, or programmatically via `PUT /api/projects/:projectId/preferred-worker`.

If no specific worker is preferred, Code UX falls back to load-balancing across capable connections, or spinning up an ephemeral virtual worker via the [Virtual worker service](../../architecture/virtual-workers.md).

## Project settings

Each project has its own settings *overrides*. Fields not overridden inherit from system settings.

To edit:

1. Open **Settings** from the dock.
2. Switch the scope selector to **Project**.
3. Make changes — they apply only to this project.

The merged ("effective") settings are previewed in a side panel and can also be fetched programmatically at `GET /api/projects/:projectId/settings/effective`.

See [Settings](./settings.md) and the [Settings reference](../../developer/settings-reference.md) for the full schema.

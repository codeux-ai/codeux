# Projects

The **Projects** page (`/projects`) lists every project Code UX manages and lets you create, edit, select, and delete them.
Each card now surfaces the source badge, repository URL, local workspace directory, creation and update timestamps, last run time, branch, provider, and host so the active checkout is easy to scan without opening a second page.

A *project* is the binding between Code UX and a single Git repository. Each project has its own:

- Sprints, tasks, runs, dispatches.
- Agent presets and memories.
- Settings overrides on top of system defaults.
- Worker assignments controlling which connected MCP clients can pick up its work.

## Creating a project

Click **Add Project** to import an existing local checkout or Git URL. Imported local projects receive only a local git-mode project override, so Code UX operates against local Git state. Imported Git URL projects inherit the system remote-git defaults. Imported projects stay techstack-unassigned until you choose a project techstack in settings, use the top bar selector, or run Project Setup Agent techstack detection.

Click **New Project** on the Projects page to initialize a new repository through the same modal. New project initialization does not scaffold application source files in the dashboard; it sends `new-local` or `new-remote` initialization data to the backend repository creation flow.

New project creation always writes an explicit project techstack override. New local projects additionally receive `git.githubMode: LOCAL`; new remote projects do not. To set up a web or desktop app inside an existing project, use **Create Web App** or **Create Desktop App** in Chat Threads beside the composer. Those quickactions operate in the selected project, create a chat thread when needed, and launch the matching detached quicksprint without opening the new-project modal.

Code UX persists whether a project was imported or initialized as a new local/remote repository. Initial-app quickactions are eligible only while a persisted new project is still a clean, one-commit seed containing exactly `README.md` and the Code UX `.gitignore`. Additional files, commits, setup artifacts, dirty state, missing checkouts, or inspection failures disable eligibility; imported and legacy projects are never inferred to be new from their source type or age.

The form collects:

| Field | Required | Description |
| --- | --- | --- |
| Name | Yes | Human-readable label. |
| Source type | Yes | Import a local directory, import a Git URL, or initialize a new project. |
| Directory path | No for local imports and new local apps | Existing or target checkout path. Blank new local paths are resolved by the backend under the user's home directory. |
| Repository URL | Yes for Git URL imports | Remote repository to clone and track. |
| Git URL slug | Yes for new remote apps | Repository slug for backend remote initialization. It auto-fills from the project name until edited. |
| Init mode | Yes for new projects | `Local Repo` creates a local repository; `Remote Repo` initializes a remote repository and clone. |
| Setup scope | Optional for imports | Runs the Project Setup Agent for imported local or Git projects. Setup can generate agents, quicksprints, preview startup, CI, a detected techstack, and opt-in docs embedding from repository evidence. New app initialization hides setup scope controls. |

On save, Code UX:

1. Imports or initializes the repository through the backend project creation flow.
2. Initialises `<repo>/.code-ux/` with project-local subdirectories (settings, sprints, agents, memory).
3. Applies only the settings overrides appropriate to the source: local git mode for imported local projects, explicit techstack for new apps, and both for new local apps.
4. Reads any external settings hints (Jules / Gemini / Codex / Claude / Qwen / OpenCode CLI auth) and pre-populates provider settings.

For imported projects, setup techstack detection inspects dependency manifests, especially `package.json`, plus lockfiles and framework config files. When the detection is valid, Code UX adds the stack to the system catalog if needed and writes the project selection to `techstack.selectedTechstackId`. Invalid or empty detections are ignored without blocking other selected setup artifacts, so imported projects are not classified until evidence or an operator assigns them.

Docs setup is opt-in from the dashboard setup scope or setup request payloads. When `docs` is true, Code UX discovers repository documentation and embeds it through the Knowledge docs library, returning embedded document IDs plus per-file errors without failing the rest of setup for a single document failure.

## Selecting the active project

Most other dashboard pages operate on a *single active project*. The active project is selectable from:

- The top bar dropdown (always visible).
- A click on any project card on the Projects page, or the card's **Open** action.
- The card's **Settings** wheel, which selects the project and opens the project-scoped settings surface.

Programmatically, the active project ID is sent with REST calls (`/api/projects/:projectId/...`) and is the implicit scope of the WebSocket subscription.

## Editing a project

Click the card's **Open** action to make it the active project, or use the **Settings** wheel to jump directly to the project-scoped settings page.

## Deleting a project

Deletion is destructive — it removes the project's database row and runtime state, but **does not** delete files inside `<repo>/.code-ux/`. The MCP `manage_projects` action requires explicit `approval.confirmed = true`.

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

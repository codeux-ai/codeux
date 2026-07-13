# Projects

The **Projects** page (`/projects`) presents every managed repository in a low-noise gallery and lets you create, select, configure, set up, and delete projects. The restrained project cards use quiet surfaces and semantic color: signal for selection and focus, green for running, red for failed or destructive state, ember for **Needs review**, and neutral styling for idle. Selection also has a visible badge and pressed state, so it never depends on color alone.

A *project* is the binding between Code UX and a single Git repository. Each project has its own:

- Sprints, tasks, runs, dispatches.
- Agent presets and memories.
- Settings overrides on top of system defaults.
- Worker assignments controlling which connected MCP clients can pick up its work.

## Reading and filtering the gallery

Each project card follows a stable hierarchy:

1. Project name and source type.
2. Text status with a status dot and a source badge.
3. One repository URL or local path, followed by branch and last-run details.
4. Setup invocation progress when setup is running.
5. Sprint, open-task, completed-task, and completion values.
6. An always-visible footer for selection, setup, project settings, and deletion.

Long project names, locations, branches, source badges, and run details are truncated to one line so cards remain aligned. Full project names and non-empty location, branch, and run values remain available as browser title text. Missing metadata is shown as **Not set**, **No runs yet**, or `--` instead of changing the card layout.

The **All**, **Running**, **Idle**, and **Failed** filters show live counts and update the gallery in place. Projects that need intervention appear in **All** but are not counted as running, idle, or failed. If a filter has no matches, choose **Show all projects** or use the **Add Project** card that remains in the grid.

## Gallery states and responsive behavior

- Initial loading marks the project-card region busy, announces that projects are loading, and shows skeleton cards.
- A load error is announced as an alert and includes **Add Project**, so importing a repository remains reachable.
- A new installation shows **No projects connected** beside the **Add Project** card. A no-match filter shows a distinct status and **Show all projects**.
- **New Project** stays in the page header. **Add Project** stays in populated, collection-empty, and no-match grids.
- Cards automatically fill the available width and can shrink below their nominal desktop width. Headers, filters, card actions, form controls, and dialog actions wrap or stack on mobile, while long metadata stays inside the card instead of creating horizontal overflow.
- Setup dialogs stay within the viewport and scroll their choice area internally on short screens.

The page respects reduced motion. Optional hover, progress, spinner, and modal transitions stop, while selected borders, status text, focus rings, busy state, and live announcements remain visible.

## Keyboard and focus behavior

Use Tab and Shift+Tab to move through **New Project**, the status filters, each card's selection surface, and its visible actions. Filters and card controls are native buttons, so Enter or Space activates them. Every control has a visible focus ring.

The primary card surface and footer selection button expose whether the project is selected. Setup, settings, and delete are separate controls and do not accidentally select the card. The Add Project modal keeps focus inside while open, starts at the project name, and restores focus when it closes. Invalid submit announces one summary, marks the affected fields, focuses the first invalid field, and scrolls it into view; directory loading, empty folders, failures, and selected paths are also announced.

## Creating a project

Click the dashed **Add Project** card to open the shared modal in local-import mode, then choose **Local Project**, **Git URL**, or **New Project**. Imported local projects receive only a local git-mode project override, so Code UX operates against local Git state. Imported Git URL projects inherit the system remote-git defaults. Imported projects stay techstack-unassigned until you choose a project techstack in settings, use the top bar selector, or run Project Setup Agent techstack detection.

Click **New Project** on the Projects page to initialize a new repository through the same modal. New project initialization does not scaffold application source files in the dashboard; it sends `new-local` or `new-remote` initialization data to the backend repository creation flow.

For a new remote repository, Code UX resolves a configured GitHub or GitLab credential through secure broker custody only for the create, clone, and initial push operation. The next attempt observes credential rotation, and an invalid, revoked, missing, unavailable, or unauthorized reference stops before remote access. When no credential reference is configured, existing environment and `gh`/`glab` local authentication remain available.

New project creation always writes an explicit project techstack override. New local projects additionally receive `git.githubMode: LOCAL`; new remote projects do not. To set up a web app, desktop app, online shop, portfolio, or game in an eligible initial project, use the matching create-app quickaction in Chat Threads beside the composer. Those quickactions operate in the selected project, create a chat thread when needed, and launch the matching detached quicksprint without opening the new-project modal. All five disappear once the seed repository changes.

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
4. Shows metadata-only provider availability after any legacy environment/JSON credentials have passed through the one-way broker migration; raw values never enter project settings.

For imported projects, setup techstack detection inspects dependency manifests, especially `package.json`, plus lockfiles and framework config files. When the detection is valid, Code UX adds the stack to the system catalog if needed and writes the project selection to `techstack.selectedTechstackId`. Invalid or empty detections are ignored without blocking other selected setup artifacts, so imported projects are not classified until evidence or an operator assigns them.

Docs setup is opt-in from the dashboard setup scope or setup request payloads. When `docs` is true, Code UX discovers repository documentation and embeds it through the Knowledge docs library, returning embedded document IDs plus per-file errors without failing the rest of setup for a single document failure.

## Selecting the active project

Most other dashboard pages operate on a *single active project*. The active project is selectable from:

- The top bar dropdown (always visible).
- The main selection surface on a project card or its **Select project** footer action.
- The card's **Project settings** action, which selects the project before opening the project-scoped settings surface.

Programmatically, the active project ID is sent with REST calls (`/api/projects/:projectId/...`) and is the implicit scope of the WebSocket subscription.

## Editing a project

Use **Select project** to make a project active, or use **Project settings** to select it and jump directly to `/config`. The settings page keeps project-specific changes as overrides on top of the system configuration.

## Deleting a project

Deletion is destructive. The project card's **Delete project** action sends the existing dashboard deletion request immediately and refreshes the gallery, so verify the target before activating it. Project deletion removes the project and its associated local runtime data; it does not delete the repository checkout or files inside `<repo>/.code-ux/`.

The Settings **Danger Zone** provides a confirmation dialog for its **Delete Project** workflow. Programmatic deletion through the MCP `manage_projects` action remains gated by explicit `approval.confirmed = true`.

## Running Project Setup Agent

Choose **Setup project** on an existing card to select Agents, Quicksprints, Preview Script, CI, Techstack detection, and optional Docs embedding. Starting setup uses the existing background setup flow; duplicate setup is disabled while the run is active.

The page reports setup start, running, completion, and failure through notifications. Once tracking returns an invocation ID, the card's **Project setup running** row opens that invocation in Chat. Completion notifications also retain an **Open invocation** action so generated artifacts and errors can be reviewed after the run finishes.

## Worker assignment

Preferred-worker assignment remains available programmatically through `PUT /api/projects/:projectId/preferred-worker`; the low-noise project card does not add a worker selector to its action footer.

If no specific worker is preferred, Code UX falls back to load-balancing across capable connections, or spinning up an ephemeral virtual worker via the [Virtual worker service](../../architecture/virtual-workers.md).

## Project settings

Each project has its own settings *overrides*. Fields not overridden inherit from system settings.

To edit:

1. Open **Settings** from the dock.
2. Switch the scope selector to **Project**.
3. Make changes — they apply only to this project.

The merged ("effective") settings are previewed in a side panel and can also be fetched programmatically at `GET /api/projects/:projectId/settings/effective`.

See [Settings](./settings.md) and the [Settings reference](../../developer/settings-reference.md) for the full schema.

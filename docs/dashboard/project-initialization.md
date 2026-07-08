# Project Initialization

Project Initialization runs a repository-specific setup pass through the `Project Setup Agent`.

## Entry Points

- `Add Project` keeps the existing `Initialize with Project Setup Agent` flow for imported local and git source types.
- Imported local projects save only a project-level `git.githubMode: LOCAL` override. The same dashboard git-mode updater synchronizes internal `git_manager`, `git_manager_local`, and `git_manager_remote` skills so local imports start with repo-local git behavior.
- Imported Git URL projects do not receive git-mode or techstack overrides. They continue to inherit the remote git and unassigned techstack defaults unless the operator explicitly changes project or sprint settings or runs setup techstack detection.
- `New Project` reuses the same Add Project modal with the `new_project` source selected. The modal exposes `Local Repo` / `Remote Repo` init modes instead of setup scope controls.
- Chat includes `Create Web App` and `Create Desktop App` setup quickactions for the currently selected project. Threads mode exposes them beside the composer, including empty threads, and 3D Chat keeps its idle setup chips. The thread quickactions post typed `create_app` metadata that launches the matching detached quicksprint; they do not open the new-project modal or create/import a Code UX project.
- All `new_project` submissions, local or remote, include an explicit project `techstack` override. New local projects also include `git.githubMode: LOCAL`; new remote projects do not.
- The `new_project` branch hides the Project Setup Agent section entirely and routes creation through the backend `initMode` fields.
- New local project creation treats the directory path as optional. When no directory is selected, the dashboard submits the project name and the backend resolves it under the user's home directory; relative typed paths resolve from the user's home directory, while absolute paths selected through the desktop picker are used as-is.
- New local init does not require a Git URL slug; it only needs a project name and optional local directory path.
- New remote init still requires a Git URL slug and auto-fills it from the project name until the user edits it.
- New remote init clones into the selected clone directory, or `~/.code-ux/projects` when the field is blank, and stores the project base directory as the single checkout root `~/.code-ux/projects/<repo-name>`.
- Existing projects expose a `Setup Project` action from the project card agent button.

Imported-project setup lets the operator choose which generated artifacts to create. Backend and MCP setup requests can also explicitly enable docs embedding:

- `Agents`
- `Quicksprints`
- `Preview Script`
- `CI`
- `Techstack`
- `Docs` (opt-in via setup request payload)

## Backend Flow

The dashboard calls:

- `POST /api/projects/:projectId/setup`
- `POST /api/projects/:projectId/setup` with `background: true`

Project creation can also include:

```json
{
  "setup": {
    "enabled": true,
    "options": {
      "agents": true,
      "quicksprints": true,
      "previewScript": true,
      "ci": true,
      "techstack": true,
      "docs": true
    }
  }
}
```

`ProjectSetupService` ensures a project-local `Project Setup Agent`, routes the request through the virtual provider planning path, asks for strict JSON, and applies the returned artifacts itself. This keeps the result stable when provider execution runs in Docker snapshots.

For Docker or remote provider execution, setup runs against the current remote default-branch snapshot for the project. Code UX resolves the project's saved default branch first, then the dashboard default, then `main`, and prepares the provider workspace from that branch so setup suggestions reflect the latest upstream baseline rather than an older local checkout state.

Project setup base-agent context is sourced from the bundled Code UX defaults in the app directory first, not from the mutable user home copy. The home copy is still seeded for visibility and user edits, but deleting `~/.code-ux/agents/*.md` does not remove the built-in Worker, Planning, Project manager, or Quality assurance templates from system setup prompts.

The dashboard uses background mode for user-triggered setup. The endpoint returns `202` with the created `invocationId` immediately, then the setup run continues server-side. The project card shows an `Initializing` state with the invocation short id, and toast notifications link directly to `/chat?mode=invocations&invocation=<id>` for live tracking and completion review.

## Generated Artifacts

When selected, setup can create or update:

- `.code-ux/agents/*.md` through the normal agent preset sync path
- `.code-ux/quicksprints/templates/*.md` custom project templates and project-level overrides
- `.code-ux/browser/start-preview.sh`
- `.github/workflows/code-ux-basic-checks.yml`
- `.gitlab-ci.yml`
- a detected system techstack catalog entry selected through the project's `techstack.selectedTechstackId`
- repository documentation embedded into the project's Knowledge docs library

Agent setup also updates project agent routing:

- the existing Planning agent route is preserved and never changed to `Project Setup Agent`
- task coding switches to `ORCHESTRATOR` when specialist worker agents are created
- created worker specialists are added to the orchestrator roster

Techstack setup is non-destructive and best-effort. Imported projects start with `techstack.selectedTechstackId: null`; when the operator enables `Techstack`, the Project Setup Agent inspects dependency evidence, especially `package.json`, lockfiles, workspace manifests, and framework config files. A valid result includes a stack name, description, and detected frameworks/libraries. Code UX adds the detected stack to the system catalog when no matching entry exists, then selects it for the project. Empty, invalid, or contradictory detections are ignored with a warning and do not block other selected setup artifacts.

Docs setup is opt-in and best-effort. When `docs` is enabled, Code UX discovers root documentation and files under `docs/`, then sends each file through the shared Knowledge ingestion pipeline as repository-path docs. Successful setup results include embedded document IDs and per-file embedding errors; individual documentation failures do not fail the provider-generated setup artifacts.

## Prompt Requirements

The setup prompt requires the agent to inspect the real repository before proposing artifacts, including assistant instruction files such as `AGENTS.md`, `GEMINI.md`, `Gemini.md`, `CLAUDE.md`, `Claude.md`, project documentation, dependency manifests, package scripts, source layout, existing CI, and preview/runtime configuration. When techstack detection is enabled, `package.json` dependency sections and related manifests are treated as primary evidence.

The agent output must be repository-specific. Generic role names or stack assumptions are rejected by the prompt contract in favor of architecture-aware agents, quicksprints, preview startup commands, and CI checks.

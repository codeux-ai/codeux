# Project Initialization

Project Initialization runs a repository-specific setup pass through the `Project Setup Agent`.

## Entry Points

- `Add Project` keeps the existing `Initialize with Project Setup Agent` flow for local and git source types.
- New local project creation treats the directory path as optional. When no directory is selected, the dashboard submits the project name and the backend resolves it under the user's home directory; relative typed paths resolve from the user's home directory, while absolute paths selected through the desktop picker are used as-is.
- Local project creation, including `Local Project` and `new_project` with `Local Repo`, saves a project-level settings override for `git.githubMode: LOCAL`. The same dashboard git-mode updater synchronizes internal `git_manager`, `git_manager_local`, and `git_manager_remote` skills so local projects start with repo-local git behavior.
- `New Project` opens the same modal with the `new_project` source selected, which exposes `Local Repo` / `Remote Repo` init modes instead of the setup scope controls.
- The `new_project` branch hides the Project Setup Agent section entirely and routes creation through the backend `initMode` fields.
- `new_project` local init does not require a Git URL slug; it only needs a project name and optional local directory path.
- `new_project` remote init still requires a Git URL slug and auto-fills it from the project name until the user edits it.
- `new_project` remote init clones into the selected clone directory, or `~/.code-ux/projects` when the field is blank, and stores the project base directory as the single checkout root `~/.code-ux/projects/<repo-name>`.
- `new_project` remote init and existing Git URL projects do not receive a local-mode settings override. They continue to inherit the remote git defaults unless the operator explicitly changes the project or sprint settings.
- Existing projects expose a `Setup Project` action from the project card agent button.

Both flows let the operator choose which artifacts to create:

- `Agents`
- `Quicksprints`
- `Preview Script`
- `CI`

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
      "ci": true
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

Agent setup also updates project agent routing:

- the existing Planning agent route is preserved and never changed to `Project Setup Agent`
- task coding switches to `ORCHESTRATOR` when specialist worker agents are created
- created worker specialists are added to the orchestrator roster

## Prompt Requirements

The setup prompt requires the agent to inspect the real repository before proposing artifacts, including assistant instruction files such as `AGENTS.md`, `GEMINI.md`, `Gemini.md`, `CLAUDE.md`, `Claude.md`, project documentation, dependency manifests, package scripts, source layout, existing CI, and preview/runtime configuration.

The agent output must be repository-specific. Generic role names or stack assumptions are rejected by the prompt contract in favor of architecture-aware agents, quicksprints, preview startup commands, and CI checks.

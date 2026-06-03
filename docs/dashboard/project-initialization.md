# Project Initialization

Project Initialization runs a repository-specific setup pass through the `Project Setup Agent`.

## Entry Points

- `Add Project` includes `Initialize with Project Setup Agent`, checked by default in the dashboard.
- When that checkbox is enabled, the dialog opens a setup scope step before creation.
- Existing projects expose a `Setup Project` action from the project card agent button.
- The Add Project modal also includes a `New Project` source type for blank project creation.
- When `New Project` is selected, the local and git-specific fields are hidden and the modal switches to its own init-mode controls instead of the standard setup flow.

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

The dashboard uses background mode for user-triggered setup. The endpoint returns `202` with the created `invocationId` immediately, then the setup run continues server-side. The project card shows an `Initializing` state with the invocation short id, and toast notifications link directly to `/chat?mode=invocations&invocation=<id>` for live tracking and completion review.

Project creation also resolves local storage paths before the record is persisted:

- git projects keep using the configured clone root and repository name
- local projects with an empty `sourceRef` now default to `~/.codex-ux/projects/<slug>`
- local projects with a relative `sourceRef` are resolved against the user's home directory before persistence
- the Add Project modal mirrors that contract by making the local Directory Path optional and leaving the path empty when the operator wants the backend default
- when that default path is used, the same resolved path is stored as `source_ref` so later lookups do not depend on an empty string placeholder

## Generated Artifacts

When selected, setup can create or update:

- `.code-ux/agents/*.md` through the normal agent preset sync path
- `.quicksprints/*.json` custom project templates
- `.code-ux/browser/start-preview.sh`
- `.github/workflows/code-ux-basic-checks.yml`
- `.gitlab-ci.yml`

Agent setup also updates project agent routing:

- planning defaults to `Project Setup Agent`
- task coding switches to `ORCHESTRATOR` when specialist worker agents are created
- created worker specialists are added to the orchestrator roster

## Prompt Requirements

The setup prompt requires the agent to inspect the real repository before proposing artifacts, including assistant instruction files such as `AGENTS.md`, `GEMINI.md`, `Gemini.md`, `CLAUDE.md`, `Claude.md`, project documentation, dependency manifests, package scripts, source layout, existing CI, and preview/runtime configuration.

The agent output must be repository-specific. Generic role names or stack assumptions are rejected by the prompt contract in favor of architecture-aware agents, quicksprints, preview startup commands, and CI checks.

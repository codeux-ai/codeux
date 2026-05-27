# Project Initialization

Project Initialization runs a repository-specific setup pass through the `Project Setup Agent`.

## Entry Points

- `Add Project` includes `Initialize with Project Setup Agent`, checked by default in the dashboard.
- When that checkbox is enabled, the dialog opens a setup scope step before creation.
- Existing projects expose a `Setup Project` action from the project card agent button.

Both flows let the operator choose which artifacts to create:

- `Agents`
- `Quicksprints`
- `Preview Script`
- `CI`

## Backend Flow

The dashboard calls:

- `POST /api/projects/:projectId/setup`

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

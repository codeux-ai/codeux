# Settings

The **Settings** page (`/config`) is the unified configuration surface. It exposes every tunable in the engine, organised into a category rail and content panels.

## The scope hierarchy

Settings are evaluated as a cascade:

```
Defaults → System → Project → Sprint
```

You can edit at any level. Higher levels override lower ones; unspecified fields inherit. The side panel always shows the **effective** (merged) value.

Switch scope with the selector at the top:

- **System** — applies to all projects.
- **Project** — applies to the active project.
- **Sprint** — applies to the selected sprint within the active project.

## Categories

The category rail on the left includes:

| Category | What it covers |
| --- | --- |
| **AI providers** | Provider configs (model, thinking mode, weight, API key, auth path, max concurrency, token pricing). |
| **Routing** | Per-invocation-type routing (`task_coding`, `planning`, …). Profiles: `GLOBAL` and `WORKER`. |
| **Workers** | Virtual worker provider, execution mode (DOCKER/HOST), Docker image, mount paths. |
| **CI & Merge** | `ciIntelligence` block — autofix retries, comment resolution, auto-merge modes. |
| **Automation** | `automationLevel` (`FULL`/`SEMI_AUTO`/`ALWAYS_ASK`), action-required automation toggles. |
| **Sprint loop** | Watch loop intervals, which loop steps are enabled. |
| **Git** | Default branch, feature branch prefix, branch scheme, GitHub mode. |
| **Skills** | Internal skill toggles (`git_manager_remote`, `git_manager_local`, etc.). |
| **MCP tools** | Per-tool enable / disable. |
| **Memory** | Active embedding model selection. |
| **Appearance** | Theme, navigation mode override, dashboard density. |
| **Limits** | `maxFailures` emergency stop threshold and other safety caps. |

Each category opens one or more **content panels** with grouped fields. Inputs are typed (text, number with min/max, toggle, multi-select) and validate inline.

## Saving & resetting

Each scope has a **Save** button at the panel footer that persists changes and broadcasts a real-time event so other connected clients refresh.

A **Reset to defaults** button at scope level removes all overrides for that scope (system reset is destructive and requires confirmation).

## Effective settings preview

A side panel shows the *effective* settings for the current scope — i.e. after merging defaults / system / project / sprint. Useful when overriding an obscure field and you want to confirm the final value.

You can also fetch effective settings programmatically:

- `GET /api/projects/:projectId/settings/effective`
- `GET /api/projects/:projectId/sprints/:sprintId/settings/effective`

## External settings hints

The **AI providers** category includes a **Detected** column. Code UX inspects:

- `JULES_API_KEY` / `JULES_KEY` env vars.
- `~/.gemini/`, `~/.codex/`, `~/.claude/`, `~/.qwen/`, `~/.local/share/opencode/` for installed-CLI auth.
- `GITHUB_TOKEN` / `GH_TOKEN` env vars and `gh auth status`.

If a hint is detected, the panel offers a one-click **Use detected value** button so you don't paste secrets manually.

## Connections panel

A separate **Connections** panel lists active MCP client connections to this project — display name, role, transport, capabilities, last activity. From here you can rename connections or set the *preferred worker* for the project.

## Reset database

At the bottom of System scope is a **Reset database** action that wipes all Code UX state (projects, sprints, tasks, memories, runs) and returns to a clean install. **This is irreversible.** It is gated behind two confirmations and a typed-name match.

For the full schema, see [Settings reference](../../developer/settings-reference.md).

# Settings

The **Settings** page (`/config`) is the unified configuration surface. It exposes every tunable in the engine, organised into a category rail and content panels.

## The scope hierarchy

Settings are evaluated as a cascade:

```
System → Project → Sprint
```

(System settings contain the built-in defaults.)

You can edit at any level. Higher levels override lower ones; unspecified fields inherit. The side panel always shows the **effective** (merged) value.

Switch scope with the selector at the top:

- **System** — applies to all projects.
- **Project** — applies to the active project.
- **Sprint** — sparse overrides applied from the sprint page through the live override modal (persists only the delta relative to resolved project defaults).

## Categories

The category rail on the left includes:

| Category | What it covers |
| --- | --- |
| **01: General** | Scope, runtime, and automation posture |
| **02: Appearance** | Dashboard layout and theme preferences |
| **03: AI Models** | Provider routing, models, and weighting |
| **04: Sprint & Git** | Git flow, branch naming, merge rules, and execution runtime |
| **05: Browser Preview** | Preview runtime, browser visibility, and container policy |
| **06: Agents** | Project-local markdown mirrors and agent authoring behavior |
| **07: Memory** | Embedding models, auto-capture, and promotion policy |
| **08: Integrations** | Provider keys, Git hosts, and external connection policy |
| **09: MCP** | MCP servers injected into CLIs and built-in tool access |
| **10: Danger Zone** | Reset project overrides only when needed (destructive, irreversible actions) |

Each category opens one or more **content panels** with grouped fields. Inputs are typed (text, number with min/max, toggle, multi-select) and validate inline.

## Saving & resetting

Each scope has a **Save** button at the panel footer that persists changes and broadcasts a real-time event so other connected clients refresh.

A **Reset to defaults** button at scope level removes all overrides for that scope (system reset is destructive and requires confirmation).

## Effective settings preview

A side panel shows the *effective* settings for the current scope — i.e. after merging defaults / system / project / sprint. Useful when overriding an obscure field and you want to confirm the final value.

You can also fetch effective settings programmatically:

- `GET /api/projects/:projectId/settings/effective`
- `GET /api/projects/:projectId/sprints/:sprintId/settings/effective`

These endpoints return both the merged `settings` tree and a `sources` dictionary that tells you whether each setting value came from `system`, `project`, or `sprint`.

## External settings hints

The **Integrations** category includes a **Detected** column for AI provider credentials. Code UX inspects:

- `JULES_API_KEY` / `JULES_KEY` env vars.
- `~/.gemini/`, `~/.codex/`, `~/.claude/`, `~/.qwen/`, `~/.local/share/opencode/` for installed-CLI auth.
- `GITHUB_TOKEN` / `GH_TOKEN` env vars and `gh auth status`.

If a hint is detected, the panel offers a one-click **Use detected value** button so you don't paste secrets manually.

## Provider instances

Provider instances are configured via individual cards that support **Terminal login** UI for interactive dashboard-driven authentication, and expose granular **Auth modes** (e.g., `LOCAL_AUTH`, `ENV_KEY`, `CUSTOM_PROVIDER`). Actions on a provider instance card suppress duplicate activation while pending, and removal requires two-step confirmation.

## Connections panel

A separate **Connections** panel lists active MCP client connections to this project — display name, role, transport, capabilities, last activity. From here you can rename connections or set the *preferred worker* for the project.

## Danger zone

The **Danger zone** category groups the destructive, irreversible actions. Each is gated behind a confirmation dialog.

- **Delete project** — permanently removes the selected project and all of its tasks, sprints, memories, and context history.
- **Project memory** (shown when a project is selected) — clears that project's stored memory by tier:
  - *Short-term* — per-sprint, per-agent working memories only (long-term knowledge is kept).
  - *Long-term* — promoted project memories plus all memory claims and evidence (short-term is kept).
  - *All memory* — the project's entire memory database (every memory, claim, and evidence record).
- **System memory** (System scope) — the same three tiers, but applied across **every** project at once.
- **Reset database** (System scope) — wipes all Code UX state (projects, sprints, tasks, memories, runs) and returns to a clean install.

Clearing memory removes the stored vectors along with the rows; downloaded embedding models are left untouched. All of these actions are **irreversible**.

For the full schema, see [Settings reference](../../developer/settings-reference.md).

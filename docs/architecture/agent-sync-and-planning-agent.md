# Agent Sync And Planning Agent

## Status
Implemented

## Purpose

Sprint OS now treats dashboard agents as database-backed records that can be seeded and refreshed from markdown files under:

- `<project>/.sprint-os/agents/*.md`
- `~/.sprint-os/agents/*.md`

The first concrete built-in role is the `Planning agent`.

This agent is used by the sprint creation flow to:

- improve a sprint prompt before creation
- plan sprint subtasks after creation
- optionally start the sprint immediately after planning

## Source Of Truth

Agents are stored in sqlite and edited from the dashboard.

SQLite remains the live authority, but projects can also mirror dashboard edits into project-local markdown under:

- `<project>/.sprint-os/agents/*.md`

That mirror is controlled by the project setting:

- `agents.saveToProjectDirectory` (default `true`)

That means:

- newly discovered markdown agents are imported into sqlite automatically
- existing DB agents remain editable in the dashboard
- when project markdown mirroring is enabled, dashboard create/update writes the agent body into a project-local markdown file
- mirrored project files use a filesystem-safe slug format such as `planning_agent.md`
- editing a default or home-backed agent from the dashboard creates a project-local override file instead of modifying the default/home source
- if the linked markdown file later differs from the DB copy, the agent is marked `out_of_sync`
- the dashboard can re-import one agent or bulk-sync all out-of-sync project agents back into sqlite on demand

## Agent Metadata

`agent_presets` now stores source metadata in addition to the editable instruction body:

- `source_path`
- `source_scope`
- `source_updated_at`
- `source_imported_at`

The API record also exposes derived sync state:

- `manual`
- `synced`
- `out_of_sync`
- `missing_source`

## Import Resolution

When Sprint OS syncs project agents:

1. project-level `.sprint-os/agents` is scanned first
2. repo-default `.sprint-os/agents` from the running Sprint OS checkout is scanned second
3. home-level `.sprint-os/agents` is scanned third
4. filename without `.md` becomes the agent name
5. project-scoped files win on name collisions
6. previously unseen agents are imported into sqlite automatically

## Planning Agent Flow

The Planning agent runs through the existing connected listen-mode inbox path.

Behavior:

1. dashboard resolves the `Planning agent` from the DB
2. dashboard selects an active listen-mode planning connection, preferring `worker` and then falling back to `listener`
3. dashboard creates a thread targeted at that worker
4. dashboard posts a planning request message containing the agent instructions
5. the worker claims the inbox message and generates the reply
6. Sprint OS parses the reply and applies the result

Two request types are currently supported:

- prompt improvement
- sprint planning

Sprint planning expects structured JSON from the worker reply and creates DB task records from it.

If `autoStart` is enabled, Sprint OS starts orchestration after the tasks are created.

## Dashboard Surface

### Agents page

The Agents page now shows:

- normal editable DB agent fields
- whether an agent is DB-only or markdown-backed
- out-of-sync state for changed markdown
- `Import` action for linked markdown agents
- `Sync All` action for pulling all out-of-sync local markdown back into sqlite

### Sprints page

The sprint creation modal now supports:

- `Improve with AI`
- `Plan & Start`
- `Plan Only`
- `Save Draft`

Both `Improve with AI` and planning actions are worker-backed via the Planning agent.

## Default Agent

This repository now includes the default built-in agent file:

- `.sprint-os/agents/planning_agent.md`

That file is auto-imported when this repository is used as the selected project and no DB record exists yet.

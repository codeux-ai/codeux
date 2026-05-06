# Agents

The **Agents** page (`/agents`) manages the **agent presets** available to the active project.

An *agent preset* is a reusable persona consisting of:

- A **name** and **avatar** (avatar config is auto-generated; you can re-roll it).
- A markdown **system instruction** that prepends every session this agent runs.
- An optional **memory template** — controls how project / sprint memory is injected into prompts.
- A set of **labels** for tagging and filtering.

Agent presets show up wherever a chat thread or planning request needs to choose an agent.

## The showcase grid

Each preset is a card with avatar, name, label tags, and a one-line description. Click a card to open the **detail panel**.

## Creating an agent

Click **+ New agent**. The form collects:

- **Name** — required, unique within the project.
- **System instructions (markdown)** — the persona prompt. This is *appended* to a base preface that ensures the agent knows it operates inside Code UX.
- **Memory template override** — checkbox. When enabled, you can write a custom template that controls how `<project_memory>` and `<sprint_memory>` blocks render. Otherwise the project default is used.
- **Labels** — comma-separated tags (e.g. `planner`, `reviewer`, `migrator`).
- **Avatar** — auto-generated (geometric/colour seed). Click **Re-roll** to regenerate.

Save creates the preset and broadcasts a real-time event so connected clients refresh.

## Editing an agent

Open the detail panel and click **Edit**. All fields are editable; saving creates a new revision (older revisions are discarded — agent presets are mutable, not versioned).

## Importing / syncing from markdown

Agent presets can be defined as markdown files inside `<repo>/.code-ux/agents/<agent-id>.md` with YAML frontmatter:

```markdown
---
name: Planner
labels: [planner]
---
You are a planner agent. Decompose user requests into ...
```

To import a single file: open the agent detail panel and click **Import markdown**.

To bulk-sync all agent files in `.code-ux/agents/`: click **Sync from markdown** in the page header. Conflicts (a markdown file that matches an existing agent by name) prompt for resolution.

This makes agent presets first-class repository content — you can check them in, code-review them, and share them across teammates.

## Deleting an agent

Destructive. Requires confirmation. Threads and tasks that referenced the deleted preset fall back to the project default agent.

## Routing presets to invocation types

Where Code UX *uses* a preset is governed by the **invocation routing** settings (Settings → Routing). For each routing ID you can specify which provider config and (optionally) which agent preset is used:

- `task_coding` — coding work.
- `planning` — sprint planning.
- `dashboard_reply` — non-coding dashboard chat.
- `clarification_reply` — answering an agent's clarification request.
- `qa_review` — quality review pass.
- `ci_fix` — CI failure resolution.
- `merge_conflict` — merge conflict resolution.

A common pattern: have a "Planner" agent (Claude Opus, sober and structured) for `planning`, a "Coder" agent (Codex GPT-5) for `task_coding`, and a "Reviewer" agent for `qa_review`.

## Memory templates

When `memoryTemplateOverrideEnabled` is set, the preset's `memoryTemplateMarkdown` controls how project / sprint memories are formatted into prompts. The template uses simple `{{ }}` placeholders for memory blocks. See [Memory](./memory.md) for available placeholders.
